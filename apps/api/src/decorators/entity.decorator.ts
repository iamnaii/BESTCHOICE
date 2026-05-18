import { SetMetadata } from '@nestjs/common';

export const ENTITY_KEY = 'entity_scope';

export type EntityType = 'SHOP' | 'FINANCE';

/**
 * SP7.1 — Mark a handler as requiring access to a specific company.
 *
 *   @UseGuards(JwtAuthGuard, EntityScopeGuard)
 *   @Entity('FINANCE')
 *   @Get('contracts')
 *   getContracts() {...}
 *
 * A user who calls this handler but doesn't have FINANCE in their
 * accessibleCompanies list will be rejected by EntityScopeGuard with 403.
 */
export const Entity = (scope: EntityType) => SetMetadata(ENTITY_KEY, scope);
