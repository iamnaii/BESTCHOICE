import { IsIn, IsString } from 'class-validator';

// Accepts SUPPLIER | CUSTOMER for forward-compat; the service implements
// SUPPLIER provisioning in this phase and rejects CUSTOMER.
export class EnsureRoleDto {
  @IsString()
  @IsIn(['SUPPLIER', 'CUSTOMER'], { message: 'role ต้องเป็น SUPPLIER หรือ CUSTOMER' })
  role!: 'SUPPLIER' | 'CUSTOMER';
}
