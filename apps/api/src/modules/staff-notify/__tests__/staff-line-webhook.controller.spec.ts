import { Test } from '@nestjs/testing';
import { StaffLineWebhookController } from '../staff-line-webhook.controller';
import { StaffLineLinkService } from '../staff-line-link.service';
import { LineStaffWebhookGuard } from '../../chatbot-finance/guards/line-staff-webhook.guard';

describe('StaffLineWebhookController', () => {
  const link = { handleWebhookEvents: jest.fn().mockResolvedValue(undefined) };
  let controller: StaffLineWebhookController;
  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      controllers: [StaffLineWebhookController],
      providers: [{ provide: StaffLineLinkService, useValue: link }],
    })
      .overrideGuard(LineStaffWebhookGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = mod.get(StaffLineWebhookController);
  });

  it('is guarded by LineStaffWebhookGuard and forwards events', async () => {
    const guards = Reflect.getMetadata('__guards__', StaffLineWebhookController.prototype.receive);
    expect(guards).toContain(LineStaffWebhookGuard);
    expect(await controller.receive({ destination: 'x', events: [{ type: 'follow' }] } as never)).toEqual({ ok: true });
    expect(link.handleWebhookEvents).toHaveBeenCalledWith([{ type: 'follow' }]);
  });

  it('body without events → 200 ok without calling the service', async () => {
    expect(await controller.receive({} as never)).toEqual({ ok: true });
    expect(link.handleWebhookEvents).not.toHaveBeenCalled();
  });
});
