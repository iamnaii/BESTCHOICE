import { ValidationPipe } from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import { CustomersListQueryDto } from './customers-list-query.dto';

/**
 * ตั้งค่าเดียวกับ ValidationPipe ของแอปจริง (src/app.setup.ts) — ข้อสำคัญคือ
 * `enableImplicitConversion: true` ซึ่งเป็นตัวที่ทำให้ `?hasOverdue=false` เคยกลายเป็น true
 * (class-transformer แปลงตาม design:type ก่อน @Transform ของเราได้ทำงาน
 * และ Boolean('false') === true)
 */
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const meta: ArgumentMetadata = { type: 'query', metatype: CustomersListQueryDto };

const parse = (query: Record<string, unknown>) =>
  pipe.transform(query, meta) as Promise<CustomersListQueryDto>;

describe('CustomersListQueryDto · hasOverdue', () => {
  it("?hasOverdue=false ต้องไม่กลายเป็น true", async () => {
    const dto = await parse({ hasOverdue: 'false' });
    expect(dto.hasOverdue).toBe('false');
    expect(dto.hasOverdue as unknown).not.toBe(true);
  });

  it('?hasOverdue=true ยังส่งค่าที่เปิดตัวกรองได้', async () => {
    const dto = await parse({ hasOverdue: 'true' });
    expect(dto.hasOverdue).toBe('true');
  });

  it('ค่าที่ไม่ใช่ true/false ได้ 400 ไม่ใช่ถูกตีความเงียบ ๆ', async () => {
    await expect(parse({ hasOverdue: '1' })).rejects.toThrow();
  });

  it('ไม่ส่งมาเลย = ไม่มีตัวกรอง', async () => {
    const dto = await parse({});
    expect(dto.hasOverdue).toBeUndefined();
  });
});
