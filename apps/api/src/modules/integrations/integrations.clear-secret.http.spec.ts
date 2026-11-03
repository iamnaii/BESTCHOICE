import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { IntegrationConfigService } from './integration-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AccessPolicyService } from '../employee-access/access-policy';
import { ACCESS_POLICIES } from '../employee-access/access-policy.registry';

/**
 * Task 32 — `DELETE /integrations/:key/config/:field` ("ล้างค่า" in the hub edit dialog).
 * Writes stay as restrictive as `PUT /integrations/:key/config` (OWNER only) even though
 * ACCOUNTANT can open the page read-only. The route is registered in the access manifest
 * (an unregistered route is 403 for everyone through `AccessPolicyService`).
 */
describe('DELETE /integrations/:key/config/:field (HTTP)', () => {
  let app: INestApplication;
  let actor = { id: 'u-OWNER', role: 'OWNER' };
  const clearSecret = jest.fn();

  beforeAll(async () => {
    const policies = new AccessPolicyService(new Reflector());
    const module = await Test.createTestingModule({
      controllers: [IntegrationsController],
      providers: [
        { provide: PrismaService, useValue: {} },
        RolesGuard,
        { provide: IntegrationsService, useValue: { clearSecret } },
        { provide: IntegrationConfigService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        // Stands in for passport only — the manifest gate is the real one, like JwtAuthGuard.
        canActivate: async (context: ExecutionContext) => {
          context.switchToHttp().getRequest().user = {
            ...actor,
            access: { userId: actor.id, managed: false },
          };
          await policies.authorize(context);
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    clearSecret.mockReset().mockResolvedValue({ cleared: true });
  });

  it('is classified like the other hub writes (integrations.manage, no record)', () => {
    expect(ACCESS_POLICIES['IntegrationsController.clearSecret']).toMatchObject({
      classification: 'staff',
      permission: 'integrations.manage',
      resolution: 'none',
      transport: "Delete(':key/config/:field')",
    });
    expect(ACCESS_POLICIES['IntegrationsController.clearSecret'].permission).toBe(
      ACCESS_POLICIES['IntegrationsController.saveConfig'].permission,
    );
  });

  it('OWNER → 200 · passes integration, field and the actor to the service', async () => {
    actor = { id: 'u-OWNER', role: 'OWNER' };
    const res = await request(app.getHttpServer())
      .delete('/integrations/line-finance/config/channelToken')
      .expect(200);
    expect(res.body).toEqual({ cleared: true });
    expect(clearSecret).toHaveBeenCalledWith('line-finance', 'channelToken', 'u-OWNER');
  });

  it.each(['ACCOUNTANT', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'SALES'])(
    '%s → 403 and the service is never reached (save is OWNER-only too)',
    async (role) => {
      actor = { id: `u-${role}`, role };
      await request(app.getHttpServer())
        .delete('/integrations/line-finance/config/channelToken')
        .expect(403);
      expect(clearSecret).not.toHaveBeenCalled();
    },
  );
});
