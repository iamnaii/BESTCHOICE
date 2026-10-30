import { Prisma } from '@prisma/client';

/** ก้อน 10 D3 Task 1 — สัญญาสคีมาของโมดูลลงเวลา (สเปก §9) อ่านจาก Prisma DMMF แบบเดียวกับ trash-registry.spec */
const model = (name: string) => {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === name);
  if (!m) throw new Error(`model ${name} missing`);
  return m;
};
const fields = (name: string) => model(name).fields.map((f) => f.name);

describe('attendance schema contract', () => {
  it('S1 attendance models exist with the contract fields', () => {
    expect(fields('AttendanceDay')).toEqual(
      expect.arrayContaining([
        'userId', 'branchId', 'workDate', 'dayKind', 'clockIn', 'clockOut', 'clockInPunchId', 'clockOutPunchId',
        'workedMinutes', 'lateMinutes', 'earlyLeaveMinutes', 'otHours', 'flags', 'note', 'correctedCount', 'deletedAt',
      ]),
    );
    expect(fields('AttendancePunch')).toEqual(expect.arrayContaining(['deviceId', 'userId', 'branchId', 'kind', 'at', 'photoKey', 'ip', 'userAgent', 'geoLat', 'geoLng', 'flags']));
    expect(fields('AttendanceDevice')).toEqual(
      expect.arrayContaining(['branchId', 'name', 'status', 'currentGeneration', 'lastSeenAt', 'lastCleanHeartbeatAt', 'lastIp', 'lastUserAgent', 'pinFailCount', 'pinLockedUntil', 'registeredById', 'deletedAt']),
    );
    expect(fields('AttendanceDeviceToken')).toEqual(expect.arrayContaining(['deviceId', 'generation', 'tokenHash', 'issuedAt', 'usedAt']));
    expect(fields('AttendanceDeviceRequest')).toEqual(expect.arrayContaining(['deviceId', 'requestId', 'responseJson', 'createdAt']));
    expect(fields('AttendanceRegistrationCode')).toEqual(expect.arrayContaining(['branchId', 'codeHash', 'expiresAt', 'usedAt', 'createdById']));
    expect(fields('AttendanceDeviceEvent')).toEqual(expect.arrayContaining(['deviceId', 'kind', 'ip', 'userAgent', 'detail', 'createdAt']));
    expect(fields('AttendanceCorrection')).toEqual(expect.arrayContaining(['dayId', 'changedById', 'reason', 'before', 'after', 'createdAt']));
    expect(model('User').fields.some((f) => f.name === 'attendancePinHash' && f.isUnique)).toBe(true);
    expect(fields('Branch')).toEqual(expect.arrayContaining(['workStart', 'workEnd']));
  });

  it('S2 AttendanceDay is unique per user per Thai date · tokens unique per device generation · requests unique per device requestId', () => {
    expect(model('AttendanceDay').uniqueFields).toEqual(expect.arrayContaining([['userId', 'workDate']]));
    expect(model('AttendanceDeviceToken').uniqueFields).toEqual(expect.arrayContaining([['deviceId', 'generation']]));
    expect(model('AttendanceDeviceRequest').uniqueFields).toEqual(expect.arrayContaining([['deviceId', 'requestId']]));
    expect(model('AttendanceDeviceToken').fields.some((f) => f.name === 'tokenHash' && f.isUnique)).toBe(true);
  });

  it('S3 enums carry the spec values', () => {
    const values = (name: string) => Prisma.dmmf.datamodel.enums.find((e) => e.name === name)?.values.map((v) => v.name);
    expect(values('AttendanceDayKind')).toEqual(['WORK', 'DAY_OFF', 'LEAVE_SICK', 'LEAVE_PERSONAL', 'LEAVE_OTHER', 'SHOP_CLOSED']);
    expect(values('AttendanceDeviceStatus')).toEqual(['ACTIVE', 'REVOKED', 'LOCKED']);
    expect(values('AttendancePunchKind')).toEqual(['IN', 'OUT']);
    expect(values('AttendanceDeviceEventKind')).toEqual(['REGISTERED', 'TOKEN_CONFLICT', 'PIN_LOCKOUT', 'REVOKED', 'UNLOCKED', 'OFFLINE']);
  });
});
