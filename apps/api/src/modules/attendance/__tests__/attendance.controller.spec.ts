import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DEFAULT_ACCESS_POSITIONS, PERMISSION_CATALOG } from '@installment/shared';
import { AttendanceController } from '../attendance.controller';
import { AttendanceDevicesController } from '../attendance-devices.controller';
import { CorrectDayDto, SetDayKindsDto, UpdateAttendanceSettingsDto } from '../dto/attendance.dto';

/** ก้อน 10 D3 Task 5 — role ต่อ route · manifest/catalog/boundary ลงทะเบียนครบ (สเปก §8 · Global Constraints) */
const roles = (ctor: { prototype: object }, method: string) => Reflect.getMetadata('roles', (ctor.prototype as Record<string, object>)[method]);
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../employee-access/access-policy.manifest.json'), 'utf8'));

describe('attendance controllers', () => {
  it('C1 roles per route: read/manage = OWNER+BRANCH_MANAGER · clearConflict + devices/settings = OWNER · me = every staff role', () => {
    for (const m of ['today', 'month', 'photo', 'correctDay', 'setDayKinds']) expect(roles(AttendanceController, m)).toEqual(['OWNER', 'BRANCH_MANAGER']);
    expect(roles(AttendanceController, 'clearConflict')).toEqual(['OWNER']);
    expect(roles(AttendanceController, 'me')).toEqual(expect.arrayContaining(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES']));
    for (const m of ['list', 'issueCode', 'revoke', 'unlock', 'events', 'getSettings', 'updateSettings']) expect(roles(AttendanceDevicesController, m)).toEqual(['OWNER']);
  });

  it('C2 manifest: every attendance route is classified (read/manage GRANT keys · devices OWNER key · me self-service)', () => {
    const expectKey = (key: string, classification: string, permission: string | null) => expect(manifest[key]).toMatchObject({ classification, permission });
    for (const m of ['today', 'month', 'photo']) expectKey(`AttendanceController.${m}`, 'staff', 'attendance.read');
    for (const m of ['correctDay', 'setDayKinds']) expectKey(`AttendanceController.${m}`, 'staff', 'attendance.manage');
    expectKey('AttendanceController.clearConflict', 'staff', 'attendance.devices');
    expectKey('AttendanceController.me', 'self-service', null);
    for (const m of ['list', 'issueCode', 'revoke', 'unlock', 'events', 'getSettings', 'updateSettings']) expectKey(`AttendanceDevicesController.${m}`, 'staff', 'attendance.devices');
    expectKey('UsersController.resetAttendancePin', 'staff', 'users.manage');
  });

  it('C3 catalog: the three attendance keys exist in group people with the right authority, and the BRANCH_MANAGER template grants read+manage', () => {
    const def = (key: string) => PERMISSION_CATALOG.find((p) => p.key === key);
    expect(def('attendance.read')).toMatchObject({ group: 'people', ownerOnly: false });
    expect(def('attendance.manage')).toMatchObject({ group: 'people', ownerOnly: false });
    expect(def('attendance.devices')).toMatchObject({ group: 'people', ownerOnly: true });
    const bm = DEFAULT_ACCESS_POSITIONS.find((p) => p.code === 'BRANCH_MANAGER')!;
    expect(bm.permissions).toEqual(expect.arrayContaining(['attendance.read', 'attendance.manage']));
  });

  it('C4 DTO validation: reason ≥ 10 · dayKind enum · date YYYY-MM-DD · settings clocks HH:mm', async () => {
    expect(await validate(plainToInstance(CorrectDayDto, { clockOut: '2026-10-27T13:30:00.000Z', reason: 'ลืมตอกออก มีลูกค้าถึงสองทุ่มครึ่ง' }))).toEqual([]);
    expect((await validate(plainToInstance(CorrectDayDto, { reason: 'สั้น' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(CorrectDayDto, { reason: 'ยาวพอสิบตัวอักษรแน่นอน', dayKind: 'HOLIDAY' }))).length).toBeGreaterThan(0);
    expect(await validate(plainToInstance(SetDayKindsDto, { branchId: '11111111-1111-4111-8111-111111111111', entries: [{ userId: '22222222-2222-4222-8222-222222222222', date: '2026-10-29', dayKind: 'DAY_OFF' }] }))).toEqual([]);
    expect((await validate(plainToInstance(SetDayKindsDto, { branchId: '11111111-1111-4111-8111-111111111111', entries: [{ userId: 'x', date: '29/10/2026', dayKind: 'DAY_OFF' }] }))).length).toBeGreaterThan(0);
    expect(await validate(plainToInstance(UpdateAttendanceSettingsDto, { workStart: '10:00', workEnd: '19:00', lateGraceMinutes: 15 }))).toEqual([]);
    expect((await validate(plainToInstance(UpdateAttendanceSettingsDto, { workStart: '25:00' }))).length).toBeGreaterThan(0);
  });
});
