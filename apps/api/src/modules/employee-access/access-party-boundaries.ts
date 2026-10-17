import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService } from './access-resource.service';
import { currentDomainAccess } from './access-execution-context';
import { requestedAccessCompany } from './access-shop-boundaries';

export const PARTY_WRITE_ROUTES = [
  'CustomersController.create',
  'CustomersController.update',
  'CustomersController.remove',
  'ContactsController.ensureRole',
] as const;
@Injectable()
export class AccessPartyBoundaries implements OnModuleInit {
  constructor(private readonly resources: AccessResourceService) {}
  onModuleInit() {
    for (const route of PARTY_WRITE_ROUTES)
      ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
        const company = requestedAccessCompany(req);
        return {
          kind: 'selection',
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
                    const actor = await ctx.client.user.findUniqueOrThrow({
                      where: { id: ctx.snapshot.userId },
                    });
                    req.user = {
                      ...req.user,
                      id: actor.id,
                      role: actor.role,
                      access: ctx.snapshot,
                    };
                    const result = (await handler()) as Record<string, unknown>;
                    // Mutation acknowledgement never doubles as a broad party/history read.
                    return route === 'ContactsController.ensureRole'
                      ? {
                          contactId: result.contactId,
                          role: result.role,
                          ...(result.customerId ? { customerId: result.customerId } : {}),
                          ...(result.supplierId ? { supplierId: result.supplierId } : {}),
                          provisioned: result.provisioned,
                        }
                      : { id: result.id };
                  },
                  false,
                  {
                    domain: 'parties',
                    isolationLevel: 'Serializable',
                    maxAttempts: 3,
                    retryUniqueConflict: true,
                  },
                )
              ).result;
            } catch (error) {
              if (
                error instanceof ConflictException ||
                (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
              )
                throw new ConflictException('ข้อมูลซ้ำหรือเปลี่ยนแปลง กรุณาตรวจสอบแล้วลองใหม่');
              throw error;
            }
          },
        };
      });
  }
}
