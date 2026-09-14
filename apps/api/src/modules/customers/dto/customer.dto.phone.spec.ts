import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCustomerDto } from './customer.dto';

const errorsFor = async (body: Record<string, unknown>) =>
  (await validate(plainToInstance(UpdateCustomerDto, body))).map((e) => e.property);

describe('UpdateCustomerDto.phone — ผู้สนใจอัตโนมัติ', () => {
  it('ไม่ส่ง phone → ผ่าน (คงค่าเดิม / ยังไม่มีเบอร์ก็เว้นได้)', async () => {
    expect(await errorsFor({ nickname: 'เล็ก' })).not.toContain('phone');
  });
  it('phone: null → ปฏิเสธ (ล้างเบอร์ไม่ได้)', async () => {
    expect(await errorsFor({ phone: null })).toContain('phone');
  });
  it('phone: "" → ปฏิเสธ', async () => {
    expect(await errorsFor({ phone: '' })).toContain('phone');
  });
  it('phone ถูกรูปแบบ → ผ่าน', async () => {
    expect(await errorsFor({ phone: '0812345678' })).not.toContain('phone');
  });
});
