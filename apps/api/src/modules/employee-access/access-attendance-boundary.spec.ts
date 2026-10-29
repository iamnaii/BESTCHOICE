import * as fs from 'fs';
import * as path from 'path';
import { AccessAttendanceBoundary, ATTENDANCE_BOUNDARY_ROUTES } from './access-attendance-boundary';
import { ACCESS_BOUNDARIES } from './access-policy.registry';

/**
 * ก้อน 10 D3 รีวิว I1 — boundary ของ route ลงเวลาต้อง "ห่อ" handler (selection) ไม่ใช่ collection
 * collection = interceptor คืนผลของ execute(scope) แทน handler ⇒ วันที่เปิด accessManaged หน้า today/month ได้ scope แทนข้อมูล และ PATCH ไม่บันทึก
 */
describe('AccessAttendanceBoundary', () => {
  beforeAll(() => new AccessAttendanceBoundary().onModuleInit());

  it('AB1 every attendance route decides "selection" on SHOP and its execute runs the real handler', async () => {
    for (const route of ATTENDANCE_BOUNDARY_ROUTES) {
      const boundary = ACCESS_BOUNDARIES.get(route);
      expect(boundary).toBeDefined();
      const decision = await boundary!({} as never, {} as never, 'attendance.read' as never);
      expect(decision).toMatchObject({ kind: 'selection', company: 'SHOP' });
      const handler = jest.fn(async () => ({ rows: ['real'] }));
      await expect((decision as { execute: (h: () => Promise<unknown>) => Promise<unknown> }).execute(handler)).resolves.toEqual({ rows: ['real'] });
      expect(handler).toHaveBeenCalledTimes(1);
    }
  });

  it('AB2 the manifest declares those routes with resolution "record" (the policy only accepts selection on record routes)', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'access-policy.manifest.json'), 'utf8'));
    for (const route of ATTENDANCE_BOUNDARY_ROUTES) expect(manifest[route]).toMatchObject({ resource: 'domain', company: 'SHOP-source', resolution: 'record' });
  });
});
