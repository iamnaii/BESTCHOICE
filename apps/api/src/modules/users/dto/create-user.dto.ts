import { IsEmail, IsString, MinLength, IsOptional, IsIn } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  name: string;

  @IsString()
  @IsIn(['SALES', 'BRANCH_MANAGER', 'ACCOUNTANT', 'OWNER'])
  role: string;

  @IsOptional()
  @IsString()
  branchId?: string;
}
