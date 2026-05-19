/**
 * SP7.5 — Tax entity rules per BC SHOP / FINANCE split.
 *
 * - SHOP: not VAT-registered → no PP30
 * - SHOP: has PND series (1/3/53/50/51) for payroll + WHT + corporate income
 * - FINANCE: has full set (PP30 + PND series)
 */

import { BadRequestException } from '@nestjs/common';

export type EntityScope = 'SHOP' | 'FINANCE';

export const ALLOWED_BY_ENTITY: Record<EntityScope, string[]> = {
  SHOP: ['PND1', 'PND3', 'PND53', 'PND50', 'PND51'],
  FINANCE: ['PP30', 'PND1', 'PND3', 'PND53', 'PND50', 'PND51'],
};

export function ensureTaxTypeAllowedForEntity(entity: EntityScope, reportType: string): void {
  const allowed = ALLOWED_BY_ENTITY[entity];
  if (!allowed.includes(reportType)) {
    throw new BadRequestException(
      `${reportType} ไม่สามารถยื่นภายใต้ ${entity} ได้ (${entity}: ${allowed.join(', ')})`,
    );
  }
}
