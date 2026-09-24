import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { CreateCaseDto } from '../dto/create-case.dto';

/** C6 (final-fix brief) — `accessories` มาเป็น JSON string จาก multipart/form-data เสมอ
 * (ไม่มีทางส่ง object ตรงๆ ผ่าน FormData) — ถ้า client ส่งสตริงที่ไม่ใช่ JSON ที่ถูกต้อง
 * `JSON.parse` เดิม throw SyntaxError ดิบออกจาก @Transform ⇒ ValidationPipe ไม่รู้จัก
 * SyntaxError เป็น HttpException เลย 500 ดิบกลับไปหา client */
describe('CreateCaseDto — accessories malformed JSON (C6)', () => {
  it('accessories เป็นสตริงที่ parse ไม่ได้ → BadRequestException (400) ไม่ใช่ SyntaxError ดิบ', () => {
    expect(() => plainToInstance(CreateCaseDto, { accessories: '{not valid json' })).toThrow(
      BadRequestException,
    );
    expect(() => plainToInstance(CreateCaseDto, { accessories: '{not valid json' })).toThrow(
      'รูปแบบรายการอุปกรณ์ไม่ถูกต้อง',
    );
  });

  it('accessories เป็น JSON string ที่ถูกต้อง → parse สำเร็จตามปกติ', () => {
    const dto = plainToInstance(CreateCaseDto, {
      accessories: JSON.stringify({ box: true, charger: false }),
    });
    expect(dto.accessories).toEqual({ box: true, charger: false });
  });

  it('accessories เป็น object อยู่แล้ว (ไม่ใช่ string) → ผ่านตรงๆ ไม่พยายาม parse', () => {
    const dto = plainToInstance(CreateCaseDto, { accessories: { box: true } });
    expect(dto.accessories).toEqual({ box: true });
  });
});
