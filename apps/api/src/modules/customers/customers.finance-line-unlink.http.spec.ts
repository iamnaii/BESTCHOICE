import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerBlacklistService } from './customer-blacklist.service';
import { CustomerTierService } from './customer-tier.service';
import { SkipTracingService } from './skip-tracing.service';
import { CustomerInsightsService } from '../overdue/customer-insights.service';
import { CustomerMergeService } from '../chat-prospects/customer-merge.service';
import { PiiAuditService } from '../pii/pii-audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { AccessPolicyService } from '../employee-access/access-policy';
import { ACCESS_POLICIES } from '../employee-access/access-policy.registry';

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Task 27 — `POST /customers/:id/finance-line/unlink` (ปุ่ม "ยกเลิกการผูก" ในฟอร์มแก้ไขลูกค้า) — สิทธิ์เท่าทางยกเลิกผูกของพนักงานเดิม
 * (`PATCH /customers/:id` = OWNER/BRANCH_MANAGER) · route ลงทะเบียนใน access manifest (ไม่งั้น `AccessPolicyService` ตอบ 403 ทุกคน)
 */
describe('POST /customers/:id/finance-line/unlink (HTTP)', () => {
  let app: INestApplication;
  let actor = { id: 'u-1', role: 'OWNER' };
  const unlink = jest.fn();

  beforeAll(async () => {
    const policies = new AccessPolicyService(new Reflector());
    const module = await Test.createTestingModule({
      controllers: [CustomersController],
      providers: [
        { provide: PrismaService, useValue: {} },
        RolesGuard,
        BranchGuard,
        { provide: CustomersService, useValue: { unlinkFinanceLineByStaff: unlink } },
        { provide: PiiAuditService, useValue: {} },
        { provide: CustomerTierService, useValue: {} },
        { provide: SkipTracingService, useValue: {} },
        { provide: CustomerInsightsService, useValue: {} },
        { provide: CustomerMergeService, useValue: {} },
        { provide: CustomerBlacklistService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        // แทน passport เท่านั้น — ด่าน manifest (`AccessPolicyService.authorize`) ยังเป็นตัวจริงเหมือน JwtAuthGuard
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
    unlink.mockReset().mockResolvedValue({
      id: CUSTOMER_ID,
      unlinked: true,
      financeLine: { verified: false, linkedAt: null },
    });
  });

  it('จัดประเภทใน access manifest เป็นงานพนักงาน customers.update ต่อแถว', () => {
    expect(ACCESS_POLICIES['CustomersController.unlinkFinanceLine']).toMatchObject({
      classification: 'staff',
      permission: 'customers.update',
      resolution: 'record',
      transport: "Post(':id/finance-line/unlink')",
    });
  });

  it.each(['OWNER', 'BRANCH_MANAGER'])('%s → 201 · ส่ง id + ผู้กดให้ service', async (role) => {
    actor = { id: `u-${role}`, role };
    const res = await request(app.getHttpServer())
      .post(`/customers/${CUSTOMER_ID}/finance-line/unlink`)
      .expect(201);
    expect(res.body).toEqual({
      id: CUSTOMER_ID,
      unlinked: true,
      financeLine: { verified: false, linkedAt: null },
    });
    expect(unlink).toHaveBeenCalledWith(CUSTOMER_ID, { id: `u-${role}` });
  });

  it.each(['SALES', 'FINANCE_MANAGER', 'ACCOUNTANT'])(
    '%s → 403 ไม่ถึง service (ยกเลิกผูกได้เฉพาะ OWNER/BM เท่าทาง PATCH เดิม)',
    async (role) => {
      actor = { id: `u-${role}`, role };
      await request(app.getHttpServer())
        .post(`/customers/${CUSTOMER_ID}/finance-line/unlink`)
        .expect(403);
      expect(unlink).not.toHaveBeenCalled();
    },
  );
});
