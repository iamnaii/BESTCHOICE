import 'reflect-metadata';
import { SKIP_CSRF_KEY } from '../../../guards/skip-csrf.decorator';
import { StaffLineWebhookController } from '../staff-line-webhook.controller';

/** รีวิว C1 — LINE ไม่ส่ง X-Requested-With; CsrfGuard (APP_GUARD) จะตอบ 403 ถ้าไม่ @SkipCsrf เหมือน webhook ตัวอื่น */
describe('StaffLineWebhookController — CSRF', () => {
  it('receive() ประกาศ skipCsrf metadata', () => {
    expect(Reflect.getMetadata(SKIP_CSRF_KEY, StaffLineWebhookController.prototype.receive)).toBe(true);
  });
});
