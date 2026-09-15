import { Test } from '@nestjs/testing';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { BranchGuard } from '../auth/guards/branch.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CustomerJourneyController } from './customer-journey.controller';
import { CustomerJourneyService } from './customer-journey.service';
import { JourneyListQueryDto } from './dto/journey-list-query.dto';

describe('CustomerJourneyController', () => {
  const service = { list: jest.fn() };
  let controller: CustomerJourneyController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const allow = { canActivate: () => true };
    const module = await Test.createTestingModule({ controllers: [CustomerJourneyController], providers: [{ provide: CustomerJourneyService, useValue: service }] })
      .overrideGuard(JwtAuthGuard).useValue(allow).overrideGuard(RolesGuard).useValue(allow).overrideGuard(BranchGuard).useValue(allow).compile();
    controller = module.get(CustomerJourneyController);
  });

  it('GET customers/:id/journey เปิด 5 บทบาทเดียวกับหน้ารายละเอียดลูกค้า · ส่งต่อเฉพาะ id/role', async () => {
    expect(Reflect.getMetadata(PATH_METADATA, CustomerJourneyController)).toBe('customers');
    expect(Reflect.getMetadata(PATH_METADATA, CustomerJourneyController.prototype.list)).toBe(':id/journey');
    expect(Reflect.getMetadata(ROLES_KEY, CustomerJourneyController.prototype.list)).toEqual(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES']);
    const query = Object.assign(new JourneyListQueryDto(), { limit: 6 });
    const user = { id: 'u1', role: 'SALES', branchId: 'b1' };
    service.list.mockResolvedValue({ redirectToCustomerId: 'c2' });
    await expect(controller.list('c1', query, user)).resolves.toEqual({ redirectToCustomerId: 'c2' });
    expect(service.list).toHaveBeenCalledWith('c1', query, { id: 'u1', role: 'SALES' });
  });
});
