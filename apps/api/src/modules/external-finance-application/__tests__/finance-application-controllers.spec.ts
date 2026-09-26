import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { FinanceApplicationsController } from '../finance-applications.controller';
import { RoomFinanceApplicationsController } from '../room-finance-applications.controller';
import { GfinPrecheckSettingsController } from '../gfin-precheck-settings.controller';
import { FINANCE_APP_ROLES, GFIN_SETTINGS_ROLES } from '../constants';

/**
 * minor 10 — `.claude/rules/security.md`: ทุก method ของ controller พนักงานต้องมี `@Roles(...)` ของตัวเอง
 * (class-level ยังอยู่) · route ใหม่ที่ลืมใส่ = เทสนี้แดง
 */
describe('GFIN staff controllers — method-level @Roles on every route', () => {
  it.each([
    ['FinanceApplicationsController', FinanceApplicationsController],
    ['RoomFinanceApplicationsController', RoomFinanceApplicationsController],
  ])('%s', (_name, controller) => {
    expect(Reflect.getMetadata(ROLES_KEY, controller)).toEqual([...FINANCE_APP_ROLES]);
    const methods = Object.getOwnPropertyNames(controller.prototype).filter((m) => m !== 'constructor');
    expect(methods.length).toBeGreaterThan(0);
    for (const method of methods) {
      const handler = (controller.prototype as unknown as Record<string, unknown>)[method];
      expect({ method, roles: Reflect.getMetadata(ROLES_KEY, handler as object) }).toEqual({ method, roles: [...FINANCE_APP_ROLES] });
    }
  });
});

describe('GfinPrecheckSettingsController — OWNER/FINANCE_MANAGER on class and every route (spec §11)', () => {
  it('has method-level @Roles equal to GFIN_SETTINGS_ROLES', () => {
    expect(Reflect.getMetadata(ROLES_KEY, GfinPrecheckSettingsController)).toEqual([...GFIN_SETTINGS_ROLES]);
    const methods = Object.getOwnPropertyNames(GfinPrecheckSettingsController.prototype).filter((m) => m !== 'constructor');
    expect(methods.sort()).toEqual(['get', 'testMessage', 'update']);
    for (const method of methods) {
      const handler = (GfinPrecheckSettingsController.prototype as unknown as Record<string, unknown>)[method];
      expect({ method, roles: Reflect.getMetadata(ROLES_KEY, handler as object) }).toEqual({ method, roles: [...GFIN_SETTINGS_ROLES] });
    }
  });
});

/** minor 5 — ชื่อไฟล์ไทยของปุ่มดาวน์โหลดฝั่งพนักงานต้องเป็น RFC 5987 (`filename*=UTF-8''…`) แบบเดียวกับหน้าลิงก์สาธารณะ */
describe('FinanceApplicationsController.download', () => {
  it('sends Content-Disposition with filename*=UTF-8 and streams the file', async () => {
    const { PassThrough, Readable } = await import('stream');
    const files = { download: jest.fn().mockResolvedValue({ file: { mimeType: 'image/jpeg', originalName: 'บัตร ประชาชน.jpg', slot: 'ID_CARD' }, stream: Readable.from([Buffer.from('jpeg')]) }) };
    const controller = new FinanceApplicationsController({} as any, files as any);
    const res = Object.assign(new PassThrough(), { setHeader: jest.fn() });
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    await controller.download('app-1', 'f-1', { user: { id: 'u', role: 'OWNER' } }, res as any);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent('บัตร ประชาชน.jpg')}`);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(Buffer.concat(chunks).toString()).toBe('jpeg');
  });
});
