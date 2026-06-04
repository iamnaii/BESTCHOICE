import { IsIn, IsString } from 'class-validator';

export class EnsureRoleDto {
  @IsString()
  @IsIn(['SUPPLIER', 'CUSTOMER', 'TRADE_IN_SELLER'], {
    message: 'role ต้องเป็น SUPPLIER, CUSTOMER หรือ TRADE_IN_SELLER',
  })
  role!: 'SUPPLIER' | 'CUSTOMER' | 'TRADE_IN_SELLER';
}
