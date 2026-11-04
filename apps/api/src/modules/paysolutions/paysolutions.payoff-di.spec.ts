import { Test } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { PaySolutionsService } from './paysolutions.service';
import { ContractPaymentService } from '../contracts/contract-payment.service';

// บูตใน jest ปกติ (ไม่มี .env): strategy JWT ต้องการ secret ตอนสร้าง provider — ค่าใดก็ได้
process.env.JWT_SECRET ??= 'test-jwt-secret-di-boot';
process.env.JWT_REFRESH_SECRET ??= 'test-jwt-refresh-secret-di-boot';

/**
 * Task 41 — `PaySolutionsService` รับ `ContractPaymentService` แบบ `@Optional()` + `forwardRef` (spec เดิมสร้าง facade โดยไม่ส่ง) ⇒ ถ้า
 * `PaySolutionsModule` ไม่ import `ContractsModule` ตัวนี้จะเป็น undefined **เงียบ ๆ** แล้ว prod จะ: intent ปิดยอดตอบ 500 (fail closed) และ webhook
 * ลงทุกเงินปิดยอดแบบ FIFO + งานแจ้ง ⇒ บูต AppModule จริงเพื่อปักว่าต่อครบทั้ง intent และ webhook (precedent: verification.rich-menu-di.spec.ts)
 */
describe('PaySolutionsService — ต่อแกนปิดยอด (ContractPaymentService) ในแอปจริง (Task 41)', () => {
  it('บูต AppModule จริง: intent และ webhook ได้ ContractPaymentService ตัวเดียวกับของแอป', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    try {
      const facade = moduleRef.get(PaySolutionsService, { strict: false }) as unknown as {
        services(): { intent: { payoff?: unknown }; webhook: { payoff?: unknown } };
      };
      const contractPayment = moduleRef.get(ContractPaymentService, { strict: false });
      const { intent, webhook } = facade.services();
      expect(intent.payoff).toBeInstanceOf(ContractPaymentService);
      expect(webhook.payoff).toBe(intent.payoff);
      expect(intent.payoff).toBe(contractPayment);
    } finally {
      await moduleRef.close();
    }
  }, 180_000);
});
