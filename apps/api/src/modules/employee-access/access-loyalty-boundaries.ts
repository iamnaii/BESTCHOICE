import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService } from './access-resource.service';
import { AccessPartySourceService } from './access-party-source.service';
import { PartyQueryPlan } from './access-party-query-plan';
import { currentDomainAccess } from './access-execution-context';
import { requestedAccessCompany } from './access-shop-boundaries';
import { ManagedLoyalty } from './access-loyalty';
import { RedeemPointsDto } from '../loyalty/dto/loyalty.dto';

export const LOYALTY_BOUNDARY_ROUTES = [
  'getPoints',
  'getHistory',
  'getReferralStats',
  'redeemPoints',
].map((method) => `LoyaltyController.${method}`);
@Injectable()
export class AccessLoyaltyBoundaries implements OnModuleInit {
  constructor(
    private readonly resources: AccessResourceService,
    private readonly sources: AccessPartySourceService,
  ) {}
  onModuleInit() {
    for (const route of LOYALTY_BOUNDARY_ROUTES)
      ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
        const company = requestedAccessCompany(req);
        const execute = async () =>
          (
            await this.resources.execute(
              snapshot.userId,
              permission,
              company,
              undefined,
              async () => {
                const ctx = currentDomainAccess()!;
                const party = await PartyQueryPlan.create(ctx.client, this.sources);
                const plan = await ManagedLoyalty.create(
                  party,
                  this.sources,
                  String(req.params?.customerId ?? ''),
                  route !== 'LoyaltyController.redeemPoints',
                );
                if (route === 'LoyaltyController.getPoints') return plan.points();
                if (route === 'LoyaltyController.getReferralStats') return plan.referrals();
                if (route === 'LoyaltyController.getHistory')
                  return plan.history(
                    req.query?.page === undefined ? 1 : Number(req.query.page),
                    req.query?.limit === undefined ? 20 : Number(req.query.limit),
                  );
                const dto = plainToInstance(RedeemPointsDto, req.body ?? {});
                if ((await validate(dto, { whitelist: true })).length)
                  throw new BadRequestException('ข้อมูลการตรวจสอบแต้มไม่ถูกต้อง');
                return plan.verify(dto);
              },
              false,
              { domain: 'parties', isolationLevel: 'Serializable', maxAttempts: 3 },
            )
          ).result;
        return route === 'LoyaltyController.getHistory'
          ? { kind: 'collection', company, execute }
          : { kind: 'selection', company, execute };
      });
  }
}
