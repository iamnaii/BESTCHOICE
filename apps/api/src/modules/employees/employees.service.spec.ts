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
});
