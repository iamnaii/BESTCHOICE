import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmployeesService } from '../employees/employees.service';
import { COMPANY_ACCESS_ROLES, ROLE_COMPANY_ACCESS } from '@installment/shared';

describe('UsersService.update — T7-C7 deactivation revokes refresh tokens', () => {
  let service: UsersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        // UsersService now depends on AuditService for DI — stub it (update()
        // logs deactivation via audit.log).
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: EmployeesService, useValue: { upsertProfileTx: jest.fn() } },
      ],
    }).compile();
    service = mod.get(UsersService);
  });

  it('revokes all refresh tokens when the user transitions from active → inactive', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true });
    prisma.user.update.mockResolvedValue({ id: 'u1', isActive: false });

    await service.update('u1', { isActive: false });

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', isRevoked: false },
      data: { isRevoked: true, revokedAt: expect.any(Date) },
    });
  });

  // เกณฑ์เดียวกับ updateFull — PATCH /users/:id รับ UpdateUserDto ตัวเดียวกันและตั้งรหัสผ่านได้
  // ปล่อยให้ต่างกัน = ความปลอดภัยขึ้นกับว่าผู้เรียกบังเอิญใช้ route ไหน
  it('revokes all refresh tokens when the password changes', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true });
    prisma.user.update.mockResolvedValue({ id: 'u1', isActive: true });

    await service.update('u1', { password: 'newpass1234' });

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', isRevoked: false },
      data: { isRevoked: true, revokedAt: expect.any(Date) },
    });
  });

  it('does NOT touch refresh tokens on unrelated update (e.g. name change)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true });
    prisma.user.update.mockResolvedValue({ id: 'u1', isActive: true });

    await service.update('u1', { name: 'renamed' });

    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('does NOT revoke again if the user was already inactive', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: false });
    prisma.user.update.mockResolvedValue({ id: 'u1', isActive: false });

    await service.update('u1', { isActive: false });

    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('does NOT revoke on reactivation (false → true)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: false });
    prisma.user.update.mockResolvedValue({ id: 'u1', isActive: true });

    await service.update('u1', { isActive: true });

    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });
});

describe('UsersService.findApprovers — lean 4-eyes approver lookup', () => {
  let service: UsersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: EmployeesService, useValue: { upsertProfileTx: jest.fn() } },
      ],
    }).compile();
    service = mod.get(UsersService);
  });

  it('returns only active, non-deleted manager-role users with a PII-free select', async () => {
    await service.findApprovers();

    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    const arg = prisma.user.findMany.mock.calls[0][0];

    // Role scoping: SALES (and VIEWER) must never appear in approver dropdowns.
    expect(arg.where.role.in).toEqual(
      expect.arrayContaining(['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT']),
    );
    expect(arg.where.role.in).not.toContain('SALES');
    expect(arg.where.isActive).toBe(true);
    expect(arg.where.deletedAt).toBeNull();

    // The endpoint is exposed to every role — the select is the PII guard.
    // GET /users stays OWNER-only precisely because findAll returns PII.
    expect(arg.select).toEqual({ id: true, name: true, role: true });
  });

  it('hides system/service accounts from the approver list', async () => {
    await service.findApprovers();

    const arg = prisma.user.findMany.mock.calls[0][0];
    expect(arg.where.email.notIn).toEqual(expect.arrayContaining(['legacy-import@bestchoice.com']));
  });
});

// เหตุ 2026-09-08: users.accessible_companies เป็น String[] @default([]) ที่ไม่มีเส้นทางไหน
// เขียนค่าให้เลย ทุกบัญชีจึงเกิดมาพร้อม array ว่าง เทสต์ชุดนี้ pin ว่าทุกทางที่ INSERT users
// หรือ UPDATE users.role ต้องเขียน accessibleCompanies/primaryCompany ตาม ROLE_COMPANY_ACCESS
// (source of truth เดียวที่ packages/shared/src/company-access.ts)
describe('UsersService — สิทธิ์บริษัท derive จาก role', () => {
  let service: UsersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  const txUserCreate = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    txUserCreate.mockResolvedValue({ id: 'u1' });
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({ id: 'u1' }),
      },
      refreshToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      // create() ห่อ tx.user.create ไว้ใน $transaction แบบ callback — mock ต้องคืน tx ปลอมให้
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: jest.fn(async (cb: any) => cb({ user: { create: txUserCreate } })),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: EmployeesService, useValue: { upsertProfileTx: jest.fn() } },
      ],
    }).compile();
    service = mod.get(UsersService);
    // create() ปิดท้ายด้วย findOneFull — stub ไว้เพื่อให้เทสต์โฟกัสที่ payload ของ user.create
    jest.spyOn(service, 'findOneFull').mockResolvedValue({ id: 'u1' } as never);
  });

  describe('create()', () => {
    it.each(COMPANY_ACCESS_ROLES)(
      'เขียน accessibleCompanies/primaryCompany ตาม ROLE_COMPANY_ACCESS สำหรับ role %s',
      async (role) => {
        // หมายเหตุ: VIEWER มาถึงที่นี่ไม่ได้จริงเพราะ create-user.dto ใช้ @IsIn แค่ 5 role
        // (ทางเดียวที่สร้าง VIEWER คือ invite) แต่ service ต้อง derive ถูกอยู่ดีถ้ามีคนเปิด DTO
        await service.create({
          email: `${role.toLowerCase()}@test.com`,
          password: 'password123',
          name: 'New Staff',
          role,
        });

        const data = txUserCreate.mock.calls[0][0].data;
        expect(data.accessibleCompanies).toEqual([...ROLE_COMPANY_ACCESS[role].accessible]);
        expect(data.primaryCompany).toBe(ROLE_COMPANY_ACCESS[role].primary);
      },
    );

    it('ส่ง array ก็อปปี้ ไม่ใช่ตัวอ้างอิงของ ROLE_COMPANY_ACCESS (กัน Prisma/ผู้เรียกไปแก้ค่ากลาง)', async () => {
      await service.create({
        email: 'owner@test.com',
        password: 'password123',
        name: 'New Staff',
        role: 'OWNER',
      });

      const data = txUserCreate.mock.calls[0][0].data;
      expect(data.accessibleCompanies).not.toBe(ROLE_COMPANY_ACCESS.OWNER.accessible);
    });
  });

  describe('update()', () => {
    it('เปลี่ยน role → derive สิทธิ์บริษัทใหม่ตาม role ปลายทาง', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true, role: 'SALES' });

      await service.update('u1', { role: 'FINANCE_MANAGER' });

      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data.role).toBe('FINANCE_MANAGER');
      expect(data.accessibleCompanies).toEqual(['SHOP', 'FINANCE']);
      expect(data.primaryCompany).toBe('FINANCE');
    });

    it('ไม่แตะสิทธิ์บริษัทเมื่อ update ไม่ได้ส่ง role มา', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true, role: 'SALES' });

      await service.update('u1', { name: 'renamed' });

      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('accessibleCompanies');
      expect(data).not.toHaveProperty('primaryCompany');
    });

    // เคสที่เกิดจริงบ่อยที่สุด: ฟอร์มผู้ใช้ยัด role เดิมมาทุกครั้งแม้แก้แค่ชื่อ/เบอร์ ถ้า derive
    // ตาม `dto.role !== undefined` OWNER ที่ถูกจำกัดไว้เป็น FINANCE จะได้ SHOP คืนเงียบ ๆ
    // และเมื่อคอลัมน์ไม่ว่างแล้ว fallback จะไม่แก้กลับให้อีก
    it('ส่ง role เดิมมาด้วย (ไม่ได้เปลี่ยน) → ไม่ทับสิทธิ์บริษัทที่ตั้งไว้', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true, role: 'OWNER' });

      await service.update('u1', { role: 'OWNER', phone: '0812345678' });

      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data.role).toBe('OWNER');
      expect(data).not.toHaveProperty('accessibleCompanies');
      expect(data).not.toHaveProperty('primaryCompany');
    });
  });
});
