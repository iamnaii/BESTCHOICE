import { Test } from '@nestjs/testing';
import { AppModule } from '../../../app.module';
import { VerificationService } from './verification.service';
import { RichMenuService } from '../../line-oa/rich-menu/rich-menu.service';

// บูตใน jest ปกติ (ไม่มี .env): strategy JWT ต้องการ secret ตอนสร้าง provider — ค่าใดก็ได้
process.env.JWT_SECRET ??= 'test-jwt-secret-di-boot';
process.env.JWT_REFRESH_SECRET ??= 'test-jwt-refresh-secret-di-boot';

/**
 * Task 19 — /liff/finance-verify เป็นทางผูก LINE การเงินทางเดียว และต้องสลับ rich menu FINANCE เป็น
 * "ยืนยันแล้ว" เหมือนทางเดิม (liff/register/confirm). VerificationService หยิบ RichMenuService ผ่าน
 * ModuleRef (strict: false) เพราะ LineOaModule import ChatbotFinanceModule อยู่แล้ว — ถ้า DI เปลี่ยนจนหา
 * ไม่เจอ การสลับเมนูจะข้ามเงียบ ๆ ⇒ บูต AppModule จริงเพื่อปักไว้ (precedent:
 * contract-workflow.credit-applier.spec.ts)
 */
describe('VerificationService — resolves RichMenuService in the real app (Task 19)', () => {
  it('บูต AppModule จริง: resolveRichMenu() ได้ RichMenuService ที่มี switchRichMenu', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    try {
      const svc = moduleRef.get(VerificationService, { strict: false });
      const richMenu = (svc as unknown as { resolveRichMenu(): unknown }).resolveRichMenu();
      expect(richMenu).toBeInstanceOf(RichMenuService);
      expect(typeof (richMenu as RichMenuService).switchRichMenu).toBe('function');
    } finally {
      await moduleRef.close();
    }
  }, 120_000);
});
