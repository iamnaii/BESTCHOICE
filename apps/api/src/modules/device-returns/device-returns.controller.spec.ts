import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { DeviceReturnsController } from './device-returns.controller';
import { DeviceReturnsService } from './device-returns.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

const rolesOf = (method: string): string[] | undefined =>
  Reflect.getMetadata(
    ROLES_KEY,
    DeviceReturnsController.prototype[method as keyof DeviceReturnsController],
  );

describe('DeviceReturnsController', () => {
  let controller: DeviceReturnsController;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let service: any;
  const user = { id: 'u-1', role: 'OWNER', branchId: null };

  beforeEach(async () => {
    service = {
      preview: jest.fn().mockResolvedValue({}),
      lookup: jest.fn().mockResolvedValue([]),
      awaitingRepossession: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      list: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 }),
      findOne: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      confirm: jest.fn().mockResolvedValue({}),
      reject: jest.fn().mockResolvedValue({}),
      cancel: jest.fn().mockResolvedValue({}),
      resendLine: jest.fn().mockResolvedValue({}),
    };
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [DeviceReturnsController],
      providers: [{ provide: DeviceReturnsService, useValue: service }],
    })
      // Direct controller tests inspect role metadata; HTTP guard execution is covered separately.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = mod.get(DeviceReturnsController);
  });

  it('@Roles ตรงตาราง spec §5.0 ทุก route', () => {
    expect(rolesOf('preview')).toEqual(['OWNER', 'BRANCH_MANAGER', 'SALES']);
    expect(rolesOf('lookup')).toEqual(['OWNER', 'BRANCH_MANAGER', 'SALES']);
    expect(rolesOf('awaitingRepossession')).toEqual(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER']);
    expect(rolesOf('list')).toEqual([
      'OWNER',
      'FINANCE_MANAGER',
      'ACCOUNTANT',
      'BRANCH_MANAGER',
      'SALES',
    ]);
    expect(rolesOf('findOne')).toEqual([
      'OWNER',
      'FINANCE_MANAGER',
      'ACCOUNTANT',
      'BRANCH_MANAGER',
      'SALES',
    ]);
    expect(rolesOf('create')).toEqual(['OWNER', 'BRANCH_MANAGER', 'SALES']);
    expect(rolesOf('confirm')).toEqual(['OWNER', 'FINANCE_MANAGER']);
    expect(rolesOf('reject')).toEqual(['OWNER', 'FINANCE_MANAGER']);
    expect(rolesOf('cancel')).toEqual(['OWNER', 'BRANCH_MANAGER']);
    expect(rolesOf('resendLine')).toEqual(['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER']);
  });

  it('list: แปลง query string → service query; status นอก enum → 400', async () => {
    await controller.list(user as never, 'CONFIRMED', 'c-1', 'b-1', '2', '10');
    expect(service.list).toHaveBeenCalledWith(
      { status: 'CONFIRMED', contractId: 'c-1', branchId: 'b-1', page: 2, limit: 10 },
      user,
    );
    expect(() => controller.list(user as never, 'BOGUS')).toThrow(BadRequestException);
  });

  it('lifecycle routes ส่ง id/dto/user ต่อไป service ตรง ๆ', async () => {
    await controller.confirm('dr-1', { discountPct: 40 }, user as never);
    expect(service.confirm).toHaveBeenCalledWith('dr-1', { discountPct: 40 }, user);
    await controller.reject('dr-1', { reason: 'ใบผิดสัญญา กรุณาตรวจใหม่' }, user as never);
    expect(service.reject).toHaveBeenCalledWith(
      'dr-1',
      { reason: 'ใบผิดสัญญา กรุณาตรวจใหม่' },
      user,
    );
    await controller.cancel('dr-1', user as never);
    expect(service.cancel).toHaveBeenCalledWith('dr-1', user);
    await controller.resendLine('dr-1', user as never);
    expect(service.resendLine).toHaveBeenCalledWith('dr-1', user);
    await controller.lookup('0042', user as never);
    expect(service.lookup).toHaveBeenCalledWith('0042', user);
  });
});
