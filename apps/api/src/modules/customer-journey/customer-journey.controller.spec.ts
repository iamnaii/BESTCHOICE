import { RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { BranchGuard } from '../auth/guards/branch.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CustomerJourneyController } from './customer-journey.controller';
import { CustomerJourneyService } from './customer-journey.service';
import { CreateJourneyEntryDto } from './dto/create-journey-entry.dto';
import { JourneyListQueryDto } from './dto/journey-list-query.dto';
import { JourneyManualEntryService } from './journey-manual-entry.service';

describe('CustomerJourneyController', () => {
  const service = { list: jest.fn() };
  const manualEntries = { create: jest.fn() };
  let controller: CustomerJourneyController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const allow = { canActivate: () => true };
    const module = await Test.createTestingModule({
      controllers: [CustomerJourneyController],
      providers: [
        { provide: CustomerJourneyService, useValue: service },
        { provide: JourneyManualEntryService, useValue: manualEntries },
      ],
    })
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

  it('POST customers/:id/journey/entries เปิด 4 บทบาทที่บันทึกได้ (ไม่มี ACCOUNTANT · Q8 FM บันทึกได้) · 201 ค่าตั้งต้น · ส่ง DTO ทั้งก้อน + id/role', async () => {
    expect(Reflect.getMetadata(PATH_METADATA, CustomerJourneyController.prototype.createEntry)).toBe(':id/journey/entries');
    expect(Reflect.getMetadata(METHOD_METADATA, CustomerJourneyController.prototype.createEntry)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(ROLES_KEY, CustomerJourneyController.prototype.createEntry)).toEqual(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES']);
    // ไม่มี @HttpCode ⇒ Nest ตอบ 201 ทุกกรณี รวม "เปิดอยู่แล้ว" (entryId null)
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, CustomerJourneyController.prototype.createEntry)).toBeUndefined();
    const dto = Object.assign(new CreateJourneyEntryDto(), { kind: 'REOPENED' as const });
    const user = { id: 'u1', role: 'FINANCE_MANAGER', branchId: 'b1' };
    const response = { entryId: null, event: null, summary: { stage: 'IDENTIFIED' } };
    manualEntries.create.mockResolvedValue(response);
    await expect(controller.createEntry('c1', dto, user)).resolves.toBe(response);
    expect(manualEntries.create).toHaveBeenCalledWith('c1', dto, { id: 'u1', role: 'FINANCE_MANAGER' });
  });
});
