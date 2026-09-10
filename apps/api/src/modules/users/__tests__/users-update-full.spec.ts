import { Test } from '@nestjs/testing';
import { UsersService } from '../users.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { EmployeesService } from '../../employees/employees.service';

describe('UsersService.updateFull', () => {
  let svc: UsersService;
  const userUpdate = jest.fn().mockResolvedValue({ id: 'u1', isActive: false });
  const userFindUnique = jest.fn();
  const refreshUpdateMany = jest.fn().mockResolvedValue({ count: 2 });
  const upsertProfileTx = jest.fn().mockResolvedValue({ id: 'p1' });

  const prisma = {
    user: { findUnique: userFindUnique },
    $transaction: jest.fn(async (cb: any) =>
      cb({
        user: { update: userUpdate },
        refreshToken: { updateMany: refreshUpdateMany },
      }),
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: EmployeesService, useValue: { upsertProfileTx } },
      ],
    }).compile();
    svc = mod.get(UsersService);
    // findOneFull is called at the end of updateFull — stub it so the test focuses on tx behaviour
    jest.spyOn(svc, 'findOneFull').mockResolvedValue({ id: 'u1' } as any);
  });

  it('updates user + upserts employee in one transaction', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', isActive: true });
    await svc.updateFull('u1', { name: 'A', employee: { position: 'sales' } }, { userId: 'owner' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(upsertProfileTx).toHaveBeenCalledWith(
      expect.anything(), 'u1', { position: 'sales' }, expect.objectContaining({ userId: 'owner' }),
    );
  });

  // Shape changed 2026-08-24: was `where: { revokedAt: null } / data: { revokedAt }`,
  // which left `isRevoked = false`. `AuthService.refreshToken` gates on `isRevoked`,
  // so those rows still read as live sessions (deactivation survived only because
  // refresh ALSO re-checks `user.isActive`). Now canonical — same shape as
  // `revokeAllUserTokens` — so the one statement is correct for both triggers.
  it('revokes refresh tokens on deactivate (true→false)', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', isActive: true });
    await svc.updateFull('u1', { isActive: false }, { userId: 'owner' });
    expect(refreshUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', isRevoked: false },
      data: { isRevoked: true, revokedAt: expect.any(Date) },
    });
  });

  it('does NOT touch employee profile when employee is null', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', isActive: true });
    await svc.updateFull('u1', { name: 'A', employee: null }, { userId: 'owner' });
    expect(upsertProfileTx).not.toHaveBeenCalled();
  });

  // OWNER-initiated password reset (/users → "รีเซ็ตรหัสผ่าน") flows through this
  // same method. Changing the password without killing live sessions would leave
  // whoever knows the OLD password logged in for up to JWT_REFRESH_EXPIRATION (7d)
  // — the exact scenario the reset is meant to close. Mirrors the self-service
  // `AuthService.resetPassword`, which revokes on the same grounds.
  it('revokes refresh tokens when the password changes', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', isActive: true });
    await svc.updateFull('u1', { password: 'newpass1234' }, { userId: 'owner' });
    expect(refreshUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', isRevoked: false },
      data: { isRevoked: true, revokedAt: expect.any(Date) },
    });
  });

  it('does NOT revoke refresh tokens on a password-less profile save', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', isActive: true });
    await svc.updateFull('u1', { name: 'A', nickname: 'B' }, { userId: 'owner' });
    expect(refreshUpdateMany).not.toHaveBeenCalled();
  });

  // Deactivate + password change in one save must not double-revoke.
  it('revokes exactly once when deactivating AND changing password together', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', isActive: true });
    await svc.updateFull('u1', { isActive: false, password: 'newpass1234' }, { userId: 'owner' });
    expect(refreshUpdateMany).toHaveBeenCalledTimes(1);
  });

  // PUT /users/:id/profile คือ endpoint ที่หน้าโปรไฟล์ใช้จริงและเปลี่ยน role ได้เหมือน
  // PATCH /users/:id — ถ้าเขียนสิทธิ์บริษัทแค่ใน update() จะเหลือรูรั่วตรงนี้ เทสต์เดิม
  // ในไฟล์นี้ assert แค่ toHaveBeenCalledTimes จึงไม่เคยจับ payload ที่หายไป
  it('เปลี่ยน role → derive accessibleCompanies/primaryCompany ใหม่', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', isActive: true, role: 'SALES' });

    await svc.updateFull('u1', { role: 'ACCOUNTANT' }, { userId: 'owner' });

    const data = userUpdate.mock.calls[0][0].data;
    expect(data.role).toBe('ACCOUNTANT');
    expect(data.accessibleCompanies).toEqual(['SHOP', 'FINANCE']);
    expect(data.primaryCompany).toBe('FINANCE');
  });

  it('ไม่แตะสิทธิ์บริษัทเมื่อ save โปรไฟล์โดยไม่เปลี่ยน role', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', isActive: true, role: 'SALES' });

    await svc.updateFull('u1', { name: 'A', nickname: 'B' }, { userId: 'owner' });

    const data = userUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('accessibleCompanies');
    expect(data).not.toHaveProperty('primaryCompany');
  });
});
