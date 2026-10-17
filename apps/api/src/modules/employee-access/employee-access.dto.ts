import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateAccessPositionDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/, {
    message: 'รหัสตำแหน่งต้องเป็นตัวอักษรอังกฤษตัวใหญ่ ตัวเลข หรือขีดล่าง',
  })
  code!: string;
  @IsString()
  @Length(1, 120, { message: 'กรุณาระบุชื่อตำแหน่งไม่เกิน 120 ตัวอักษร' })
  name!: string;
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsString({ each: true })
  permissions!: string[];
}
export class UpdateAccessPositionDto {
  @IsInt() @Min(0, { message: 'กรุณาระบุรุ่นข้อมูลที่กำลังแก้ไข' }) expectedRevision!: number;
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() deleted?: boolean;
}
export class AccessAssignmentDto {
  @IsUUID() positionId!: string;
  @IsIn(['SHOP', 'FINANCE'], { message: 'กรุณาเลือกงานหน้าร้านหรืองานการเงิน' }) company!:
    | 'SHOP'
    | 'FINANCE';
  @IsIn(['BRANCHES', 'ASSIGNED', 'COMPANY'], { message: 'ขอบเขตสิทธิ์ไม่ถูกต้อง' }) scope!:
    | 'BRANCHES'
    | 'ASSIGNED'
    | 'COMPANY';
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  branchIds!: string[];
}
export class ReplaceAccessAssignmentsDto {
  @IsInt() @Min(0, { message: 'กรุณาระบุรุ่นข้อมูลที่กำลังแก้ไข' }) expectedRevision!: number;
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AccessAssignmentDto)
  assignments!: AccessAssignmentDto[];
}
