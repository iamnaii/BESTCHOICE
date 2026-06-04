import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('EmployeesService', () => {
  let service: EmployeesService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { findFirst: jest.fn() },
      employeeProfile: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
    };
    audit = { log: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(EmployeesService);
  });

  describe('provision', () => {
    it('rejects when the user does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.provision({ userId: 'u-x' })).rejects.toThrow(NotFoundException);
    });

    it('creates a profile + writes EMPLOYEE_PROFILE_CREATED audit', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u-1', name: 'สมชาย' });
      prisma.employeeProfile.create.mockResolvedValue({ id: 'e-1', userId: 'u-1' });
      const res = await service.provision({ userId: 'u-1', position: 'ช่าง' }, { userId: 'admin' });
      expect(prisma.employeeProfile.create).toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EMPLOYEE_PROFILE_CREATED', entity: 'employee_profile', entityId: 'e-1' }),
      );
      expect(res.id).toBe('e-1');
    });

    it('maps a duplicate (P2002) to ConflictException', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u-1' });
      prisma.employeeProfile.create.mockRejectedValue({ code: 'P2002' });
      await expect(service.provision({ userId: 'u-1' })).rejects.toThrow(ConflictException);
    });
  });

  describe('list', () => {
    it('filters out soft-deleted, masks nationalId, returns paginated shape', async () => {
      prisma.employeeProfile.findMany.mockResolvedValue([
        { id: 'e-1', position: 'ช่าง', employmentType: 'MONTHLY', deletedAt: null,
          user: { id: 'u-1', name: 'สมชาย', nickname: 'ชาย', employeeId: 'EMP-001',
            nationalId: '1100700000001', branchId: 'b1', isActive: true } },
      ]);
      prisma.employeeProfile.count.mockResolvedValue(1);
      const res = await service.list({ page: 1, limit: 50 });
      expect(prisma.employeeProfile.findMany.mock.calls[0][0].where.deletedAt).toBeNull();
      expect(res).toEqual(expect.objectContaining({ total: 1, page: 1, limit: 50 }));
      // masked: only last 4 visible
      expect(res.data[0].nationalId).toBe('•••••••••0001');
    });
  });

  describe('findOne', () => {
    it('throws NotFound when missing', async () => {
      prisma.employeeProfile.findFirst.mockResolvedValue(null);
      await expect(service.findOne('e-x')).rejects.toThrow(NotFoundException);
    });
    it('returns full nationalId on detail', async () => {
      prisma.employeeProfile.findFirst.mockResolvedValue({
        id: 'e-1', deletedAt: null,
        user: { id: 'u-1', name: 'สมชาย', nationalId: '1100700000001' },
      });
      const res = await service.findOne('e-1');
      expect(res.user.nationalId).toBe('1100700000001');
    });
  });

  describe('update', () => {
    it('updates fields + audits EMPLOYEE_PROFILE_UPDATED', async () => {
      prisma.employeeProfile.findFirst.mockResolvedValue({ id: 'e-1', deletedAt: null,
        user: { id: 'u-1', name: 'สมชาย', nationalId: '1100700000001' } });
      prisma.employeeProfile.update.mockResolvedValue({ id: 'e-1', position: 'หัวหน้า' });
      await service.update('e-1', { position: 'หัวหน้า' }, { userId: 'admin' });
      expect(prisma.employeeProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'e-1' } }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EMPLOYEE_PROFILE_UPDATED', entityId: 'e-1' }),
      );
    });
  });

  describe('remove', () => {
    it('soft-deletes + audits EMPLOYEE_PROFILE_DELETED', async () => {
      prisma.employeeProfile.findFirst.mockResolvedValue({ id: 'e-1', deletedAt: null,
        user: { id: 'u-1', name: 'สมชาย', nationalId: '1100700000001' } });
      prisma.employeeProfile.update.mockResolvedValue({ id: 'e-1', deletedAt: new Date() });
      await service.remove('e-1', { userId: 'admin' });
      const call = prisma.employeeProfile.update.mock.calls.at(-1)[0];
      expect(call.data.deletedAt).toBeInstanceOf(Date);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EMPLOYEE_PROFILE_DELETED', entityId: 'e-1' }),
      );
    });
  });
});
