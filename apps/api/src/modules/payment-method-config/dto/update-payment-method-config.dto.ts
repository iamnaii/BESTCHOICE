import { IsBoolean, IsInt, IsOptional } from 'class-validator';

/**
 * Only mutable fields after creation: isDefault / enabled / sortOrder.
 * Method + accountCode are immutable — to "rename", delete and recreate.
 */
export class UpdatePaymentMethodConfigDto {
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
