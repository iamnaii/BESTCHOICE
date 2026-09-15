import { Test } from '@nestjs/testing';
import { CustomerJourneyController } from './customer-journey.controller';
import { CustomerJourneyService } from './customer-journey.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

describe('CustomerJourneyController GET :id/journey/summary', () => {
  let controller: CustomerJourneyController;
  const service = { summary: jest.fn() };

  beforeEach(async () => {
    service.summary.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [CustomerJourneyController],
      providers: [{ provide: CustomerJourneyService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .overrideGuard(BranchGuard).useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(CustomerJourneyController);
  });

  it('ส่ง id + ผู้ใช้ต่อให้ service และคืน redirect ตามที่ service ตอบ', async () => {
    service.summary.mockResolvedValue({ redirectToCustomerId: 'c-real' });
    await expect(controller.summary('c-old', { id: 'u1', role: 'SALES' })).resolves.toEqual({ redirectToCustomerId: 'c-real' });
    expect(service.summary).toHaveBeenCalledWith('c-old', { id: 'u1', role: 'SALES' });
  });

  it('เปิดให้ 5 role เดียวกับหน้าลูกค้า', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CustomerJourneyController.prototype.summary)).toEqual([
      'OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES',
    ]);
  });
});
