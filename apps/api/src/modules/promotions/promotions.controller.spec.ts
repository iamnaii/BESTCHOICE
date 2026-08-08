import { Reflector } from '@nestjs/core';
import { PromotionsController } from './promotions.controller';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

/**
 * B1 เปิดหน้า /products/:id ให้ FINANCE_MANAGER + ACCOUNTANT — การ์ด
 * "โปรที่ใช้ได้ตอนนี้" กิน GET /promotions/active จึงต้องเปิด role ให้ตรงกัน
 * ไม่งั้นหน้าโหลดมาแล้วการ์ดเดียว 403. เทสต์นี้ pin metadata กันหดกลับ.
 */
describe('PromotionsController — role metadata ของ GET /promotions/active', () => {
  const reflector = new Reflector();

  const rolesOn = (methodName: string): string[] | undefined => {
    const handler = (PromotionsController.prototype as unknown as Record<string, unknown>)[
      methodName
    ];
    if (typeof handler !== 'function') return undefined;
    return reflector.get<string[]>(ROLES_KEY, handler);
  };

  it('findActive เปิดให้ 5 role ที่เข้าหน้าสินค้าได้', () => {
    const roles = rolesOn('findActive');
    expect(roles).toBeDefined();
    expect(roles).toEqual(
      expect.arrayContaining([
        'OWNER',
        'BRANCH_MANAGER',
        'FINANCE_MANAGER',
        'ACCOUNTANT',
        'SALES',
      ]),
    );
  });

  it('การสร้าง/แก้/ลบ โปรยังเป็น OWNER เท่านั้น (ไม่ถูกเผลอขยายตาม)', () => {
    expect(rolesOn('create')).toEqual(['OWNER']);
    expect(rolesOn('update')).toEqual(['OWNER']);
  });
});
