import { OmitType, PartialType } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';
import { CreateEmployeeDto } from './create-employee.dto';

// Update = all of Create's fields optional, minus userId (cannot reassign the
// owning user), plus resignedDate. Mirrors the repo convention
// (PartialType(OmitType(...)) from @nestjs/swagger — see update-asset.dto.ts,
// expense-documents/dto/update.dto.ts).
export class UpdateEmployeeDto extends PartialType(
  OmitType(CreateEmployeeDto, ['userId'] as const),
) {
  @IsOptional()
  @IsDateString({}, { message: 'วันที่ลาออกไม่ถูกต้อง' })
  resignedDate?: string;
}
