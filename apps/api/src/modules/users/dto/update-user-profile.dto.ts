import { IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateUserDto } from './update-user.dto';
import { EmployeeProfileInputDto } from './employee-profile-input.dto';

export class UpdateUserProfileDto extends UpdateUserDto {
  // null/undefined = ไม่แตะโปรไฟล์ HR; object = upsert (create ถ้ายังไม่มี / update ถ้ามี)
  @IsOptional()
  @ValidateNested()
  @Type(() => EmployeeProfileInputDto)
  employee?: EmployeeProfileInputDto | null;
}
