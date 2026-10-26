import { Test } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { ContractWorkflowService } from './contract-workflow.service';
import { PaymentsService } from '../payments/payments.service';

// บูตใน jest ปกติ (ไม่มี .env): strategy JWT ต้องการ secret ตอนสร้าง provider — ค่าใดก็ได้ ไม่มีการเข้ารหัสจริงในเทสนี้
process.env.JWT_SECRET ??= 'test-jwt-secret-di-boot';
process.env.JWT_REFRESH_SECRET ??= 'test-jwt-refresh-secret-di-boot';

/**
 * 15ข spec §6 (ผู้ตรวจอิสระ I3): hook ใช้เครดิตอัตโนมัติตอนเปิดใช้สัญญา resolve `PaymentsService` ผ่าน ModuleRef
 * (import PaymentsModule เข้า ContractsModule ทำ Nest บูตไม่ขึ้น — ledger Task 8). ถ้า DI/scope เปลี่ยนจนหาไม่เจอ
 * เส้นทางจะถอยเป็น NO_PAYMENTS_SERVICE เงียบ ๆ (Sentry warning) และเครดิตค้างทุกสัญญา — เทสนี้บูต AppModule จริงเพื่อปักไว้
 */
describe('ContractWorkflowService — resolveCreditApplier ผ่าน ModuleRef (15ข spec §6)', () => {
  it('บูต AppModule จริง: resolveCreditApplier() ได้ PaymentsService ที่มี applyCreditBalance', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    try {
      const svc = moduleRef.get(ContractWorkflowService, { strict: false });
      const applier = (svc as unknown as { resolveCreditApplier(): unknown }).resolveCreditApplier();
      expect(applier).toBeInstanceOf(PaymentsService);
      expect(typeof (applier as PaymentsService).applyCreditBalance).toBe('function');
    } finally {
      await moduleRef.close();
    }
  }, 120_000);
});
