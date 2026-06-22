import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { EmployeesService } from '../employees.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

describe('EmployeesService.upsertProfileTx', () => {
  let svc: EmployeesService;
  const tx = {
    employeeProfile: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  } as unknown as Prisma.TransactionClient;
  const audit = { log: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: PrismaService, useValue: {} },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    svc = mod.get(EmployeesService);
  });

  it('creates a profile when none exists', async () => {
    (tx.employeeProfile.findFirst as jest.Mock).mockResolvedValue(null);
    (tx.employeeProfile.create as jest.Mock).mockResolvedValue({ id: 'p1' });

    await svc.upsertProfileTx(tx, 'u1', { position: 'sales', baseSalary: 25000 }, { userId: 'owner' });

    expect(tx.employeeProfile.create).toHaveBeenCalledTimes(1);
    const arg = (tx.employeeProfile.create as jest.Mock).mock.calls[0][0];
    expect(arg.data.userId).toBe('u1');
    expect(arg.data.baseSalary).toBeInstanceOf(Prisma.Decimal);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EMPLOYEE_PROFILE_CREATED', entity: 'employee_profile' }),
    );
  });

  it('updates the existing profile', async () => {
    (tx.employeeProfile.findFirst as jest.Mock).mockResolvedValue({ id: 'p1' });
    (tx.employeeProfile.update as jest.Mock).mockResolvedValue({ id: 'p1' });

    await svc.upsertProfileTx(tx, 'u1', { position: 'cashier' }, { userId: 'owner' });

    expect(tx.employeeProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' } }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EMPLOYEE_PROFILE_UPDATED' }),
    );
  });
});
