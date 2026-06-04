import { Test } from '@nestjs/testing';
import { TestModeController } from '../test-mode.controller';
import { TestModeService } from '../test-mode.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

describe('TestModeController', () => {
  let ctrl: TestModeController;
  const svc = { isEnabled: jest.fn(), setEnabled: jest.fn() };

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      controllers: [TestModeController],
      providers: [{ provide: TestModeService, useValue: svc }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    ctrl = mod.get(TestModeController);
  });

  it('GET returns status', async () => {
    svc.isEnabled.mockResolvedValue(true);
    expect(await ctrl.get()).toEqual({ enabled: true });
  });

  it('PUT sets + returns', async () => {
    svc.setEnabled.mockResolvedValue(false);
    expect(await ctrl.set({ enabled: false })).toEqual({ enabled: false });
    expect(svc.setEnabled).toHaveBeenCalledWith(false);
  });
});
