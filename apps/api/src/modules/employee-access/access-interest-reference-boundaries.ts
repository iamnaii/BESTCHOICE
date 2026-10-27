import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { AccessSnapshot, Company, PermissionKey } from '@installment/shared';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService } from './access-resource.service';
import { currentDomainAccess } from './access-execution-context';
import { permissionScopes } from './access-context';
import { requestedAccessCompany } from './access-shop-boundaries';
import { safeReferenceError } from './access-shared-reference';

export const INTEREST_REFERENCE_ROUTES = [
  'InterestConfigController.findAll',
  'InterestConfigController.findByCategory',
  'InterestConfigController.resolveConfig',
  'InterestConfigController.findOne',
  'InterestConfigController.create',
  'InterestConfigController.update',
  'InterestConfigController.remove',
] as const;

// Shared definitions have no branch assignment. Keep permission-specific tuples;
// a live ordinary branch context authorizes reference fields, never source records.
function referenceEntry(snapshot: AccessSnapshot, permission: PermissionKey, company: Company) {
  return permissionScopes({ id: snapshot.userId, access: snapshot }, permission, company).some(
    (tuple) =>
      tuple.scope === 'COMPANY' || (tuple.scope === 'BRANCHES' && tuple.branchIds.length > 0),
  );
}

@Injectable()
export class AccessInterestReferenceBoundaries implements OnModuleInit {
  constructor(private readonly resources: AccessResourceService) {}

  onModuleInit() {
    for (const route of INTEREST_REFERENCE_ROUTES) {
      ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
        const company = requestedAccessCompany(req);
        const method = route.split('.')[1];
        const mutation = ['create', 'update', 'remove'].includes(method);
        return {
          kind: 'reference',
          company,
          execute: async (handler) => {
            try {
              return (
                await this.resources.execute(
                  snapshot.userId,
                  permission,
                  company,
                  undefined,
                  async () => {
                    const ctx = currentDomainAccess()!;
                    if (
                      !referenceEntry(ctx.snapshot, permission, company) ||
                      (mutation && !ctx.snapshot.isOwner)
                    )
                      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงข้อมูลอ้างอิง');
                    if (
                      !(await ctx.client.companyInfo.findFirst({
                        where: { companyCode: company, isActive: true, deletedAt: null },
                      }))
                    )
                      throw new ForbiddenException('ส่วนงานไม่พร้อมใช้งาน');
                    const query = req.query ?? {};
                    const allowed =
                      method === 'resolveConfig' ? ['company', 'category'] : ['company'];
                    if (
                      Object.keys(query).some((key) => !allowed.includes(key)) ||
                      Object.values(query).some((value) => typeof value !== 'string')
                    )
                      throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
                    const result = await handler();
                    if (!mutation) return result;
                    const { id } = result as { id: string };
                    await ctx.client.auditLog.create({
                      data: {
                        userId: ctx.snapshot.userId,
                        action: 'SHARED_REFERENCE_CHANGED',
                        entity: 'interest_config',
                        entityId: id,
                        newValue: {
                          route,
                          operation: method,
                          company,
                          affectedCompanies: ['SHOP', 'FINANCE'],
                        },
                      },
                    });
                    return { id };
                  },
                  false,
                  { isolationLevel: 'Serializable', maxAttempts: 3 },
                )
              ).result;
            } catch (error) {
              throw safeReferenceError(error);
            }
          },
        };
      });
    }
  }
}
