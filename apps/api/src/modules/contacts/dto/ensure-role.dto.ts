import type { ContactRoleDestination } from '@installment/shared';
import { IsIn, IsString, IsOptional, IsUUID } from 'class-validator';

export class EnsureRoleDto implements ContactRoleDestination {
  @IsOptional() @IsUUID() branchId?: string | null;
  /** Explicit current Contact assignment; never automatic. */
  @IsOptional() @IsUUID() assignedToId?: string | null;
  @IsOptional() @IsUUID() customerAssignedToId?: string | null;

  @IsString()
  @IsIn(['SUPPLIER', 'CUSTOMER', 'TRADE_IN_SELLER'], {
    message: 'role ต้องเป็น SUPPLIER, CUSTOMER หรือ TRADE_IN_SELLER',
  })
  role!: 'SUPPLIER' | 'CUSTOMER' | 'TRADE_IN_SELLER';
}
