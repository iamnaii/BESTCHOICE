import { NotFoundException } from '@nestjs/common';
import { hashPII } from '../../../utils/pii.util';
import { UsersService } from '../users.service';

/** ก้อน 10 D3 Task 5 — รีเซ็ตรหัสตอกบัตร (OWNER): สุ่ม 6 หลัก · เก็บ hashPII · ไม่ซ้ำทั้งบริษัท (retry P2002) · audit ไม่เก็บรหัส */
const SALT = 'users-attendance-pin-spec-salt-0123456789abcdef';
const ORIGINAL = process.env.PII_HASH_SALT;
beforeAll(() => { process.env.PII_HASH_SALT = SALT; });
afterAll(() => { if (ORIGINAL === undefined) delete process.env.PII_HASH_SALT; else process.env.PII_HASH_SALT = ORIGINAL; });

function harness() {
  const prisma = {
    user: {
      findFirst: jest.fn(async () => ({ id: 'u1', name: 'วรรณา ส.', nickname: 'นุ๊ก' })),
      update: jest.fn(async ({ data }: { data: { attendancePinHash: string } }) => ({ id: 'u1', attendancePinHash: data.attendancePinHash })),
    },
  };
  const audit = { log: jest.fn(async () => undefined) };
  const service = new UsersService(prisma as never, audit as never, {} as never);
  return { service, prisma, audit };
}

describe('UsersService.resetAttendancePin', () => {
  it('U1 returns a 6-digit pin, stores hashPII(pin, salt) on the user, audits without the pin', async () => {
    const h = harness();
    const out = await h.service.resetAttendancePin('u1', 'owner');
    expect(out.pin).toMatch(/^\d{6}$/);
    expect(h.prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { attendancePinHash: hashPII(out.pin, SALT) }, select: { id: true } });
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner', action: 'ATTENDANCE_PIN_RESET', entity: 'user', entityId: 'u1' }));
    expect(JSON.stringify(h.audit.log.mock.calls[0])).not.toContain(out.pin);
  });

  it('U2 a unique clash (P2002) retries with a new pin instead of failing', async () => {
    const h = harness();
    h.prisma.user.update.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    const out = await h.service.resetAttendancePin('u1', 'owner');
    expect(out.pin).toMatch(/^\d{6}$/);
    expect(h.prisma.user.update).toHaveBeenCalledTimes(2);
  });

  it('U3 unknown or deleted user → 404', async () => {
    const h = harness();
    h.prisma.user.findFirst.mockResolvedValueOnce(null as never);
    await expect(h.service.resetAttendancePin('nope', 'owner')).rejects.toThrow(NotFoundException);
  });
});
