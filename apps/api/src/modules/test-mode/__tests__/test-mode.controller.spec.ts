import { Test } from '@nestjs/testing';
import { TestModeController } from '../test-mode.controller';
import { TestModeService } from '../test-mode.service';

describe('TestModeController', () => {
  let ctrl: TestModeController;
  const svc = { isEnabled: jest.fn(), setEnabled: jest.fn() };

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      controllers: [TestModeController],
      providers: [{ provide: TestModeService, useValue: svc }],
    })
      .overrideGuard(require('../../auth/guards/jwt-auth.guard').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../../auth/guards/roles.guard').RolesGuard)
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
