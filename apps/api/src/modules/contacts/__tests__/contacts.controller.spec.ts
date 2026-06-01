import { Test } from '@nestjs/testing';
import { ContactsController } from '../contacts.controller';
import { ContactsService } from '../contacts.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

describe('ContactsController', () => {
  let ctrl: ContactsController;
  let svc: { list: jest.Mock; findOne: jest.Mock; merge: jest.Mock };

  beforeEach(async () => {
    svc = { list: jest.fn(), findOne: jest.fn(), merge: jest.fn() };
    const mod = await Test.createTestingModule({
      controllers: [ContactsController],
      providers: [{ provide: ContactsService, useValue: svc }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    ctrl = mod.get(ContactsController);
  });

  it('list delegates to service', () => {
    const dto = { page: 1, limit: 50 };
    svc.list.mockReturnValue('LIST');
    expect(ctrl.list(dto)).toBe('LIST');
    expect(svc.list).toHaveBeenCalledWith(dto);
  });

  it('findOne delegates to service', () => {
    svc.findOne.mockReturnValue('ONE');
    expect(ctrl.findOne('c1')).toBe('ONE');
    expect(svc.findOne).toHaveBeenCalledWith('c1');
  });

  it('merge delegates to service', () => {
    const dto = { primaryId: 'p1', duplicateId: 'd1' };
    svc.merge.mockReturnValue('MERGED');
    expect(ctrl.merge(dto)).toBe('MERGED');
    expect(svc.merge).toHaveBeenCalledWith(dto);
  });
});
