import { Test } from '@nestjs/testing';
import { ContactsController } from '../contacts.controller';
import { ContactsService } from '../contacts.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

describe('ContactsController.ensureRole', () => {
  let controller: ContactsController;
  let service: { ensureRole: jest.Mock };

  beforeEach(async () => {
    service = { ensureRole: jest.fn().mockResolvedValue({ supplierId: 'sup1', provisioned: true }) };
    const mod = await Test.createTestingModule({
      controllers: [ContactsController],
      providers: [{ provide: ContactsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = mod.get(ContactsController);
  });

  it('passes id, role and actor to the service', async () => {
    const req = {
      user: { id: 'u1', role: 'OWNER' },
      ip: '10.0.0.1',
      headers: { 'user-agent': 'jest' },
    } as any;

    const result = await controller.ensureRole('c1', { role: 'SUPPLIER' }, req);

    expect(service.ensureRole).toHaveBeenCalledWith('c1', 'SUPPLIER', {
      userId: 'u1',
      ipAddress: '10.0.0.1',
      userAgent: 'jest',
    });
    expect(result).toEqual({ supplierId: 'sup1', provisioned: true });
  });
});
