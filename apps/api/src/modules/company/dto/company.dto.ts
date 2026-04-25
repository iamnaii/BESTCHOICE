import {
  IsOptional,
  IsString,
  IsBoolean,
  IsNumber,
  IsNotEmpty,
  IsIn,
  Min,
  Max,
} from 'class-validator';

export class CreateCompanyDto {
  @IsString({ message: 'ชื่อบริษัท (ไทย) ต้องเป็นข้อความ' })
  @IsNotEmpty({ message: 'กรุณาระบุชื่อบริษัท (ไทย)' })
  nameTh!: string;

  @IsOptional()
  @IsString({ message: 'ชื่อบริษัท (อังกฤษ) ต้องเป็นข้อความ' })
  nameEn?: string;

  @IsOptional()
  @IsString({ message: 'เลขประจำตัวผู้เสียภาษีต้องเป็นข้อความ' })
  taxId?: string;

  // companyCode is set once at creation and becomes the system identifier.
  // Only OWNER can assign it, and it's immutable afterward.
  @IsOptional()
  @IsString({ message: 'รหัสบริษัทต้องเป็นข้อความ' })
  @IsIn(['SHOP', 'FINANCE'], { message: 'รหัสบริษัทต้องเป็น SHOP หรือ FINANCE' })
  companyCode?: 'SHOP' | 'FINANCE';

  @IsString({ message: 'ที่อยู่ต้องเป็นข้อความ' })
  @IsNotEmpty({ message: 'กรุณาระบุที่อยู่บริษัท' })
  address!: string;

  @IsOptional()
  @IsString({ message: 'เบอร์โทรศัพท์ต้องเป็นข้อความ' })
  phone?: string;

  @IsString({ message: 'ชื่อผู้มีอำนาจลงนามต้องเป็นข้อความ' })
  @IsNotEmpty({ message: 'กรุณาระบุชื่อผู้มีอำนาจลงนาม' })
  directorName!: string;

  @IsOptional()
  @IsString({ message: 'ตำแหน่งผู้มีอำนาจลงนามต้องเป็นข้อความ' })
  directorPosition?: string;

  @IsOptional()
  @IsString({ message: 'เลขประจำตัวผู้มีอำนาจลงนามต้องเป็นข้อความ' })
  directorNationalId?: string;

  @IsOptional()
  @IsString({ message: 'ที่อยู่ผู้มีอำนาจลงนามต้องเป็นข้อความ' })
  directorAddress?: string;

  @IsOptional()
  @IsBoolean({ message: 'สถานะจดทะเบียนภาษีมูลค่าเพิ่มต้องเป็น true หรือ false' })
  vatRegistered?: boolean;

  @IsOptional()
  @IsNumber({}, { message: 'อัตราภาษีมูลค่าเพิ่มต้องเป็นตัวเลข' })
  @Min(0, { message: 'อัตราภาษีมูลค่าเพิ่มต้องไม่ต่ำกว่า 0' })
  @Max(1, { message: 'อัตราภาษีมูลค่าเพิ่มต้องไม่เกิน 1' })
  vatRate?: number;

  @IsOptional()
  @IsString({ message: 'ชื่อธนาคารต้องเป็นข้อความ' })
  bankName?: string;

  @IsOptional()
  @IsString({ message: 'ชื่อบัญชีธนาคารต้องเป็นข้อความ' })
  bankAccountName?: string;

  @IsOptional()
  @IsString({ message: 'เลขบัญชีธนาคารต้องเป็นข้อความ' })
  bankAccountNumber?: string;

  @IsOptional()
  @IsString({ message: 'LINE OA ID ต้องเป็นข้อความ' })
  lineOaId?: string;

  @IsOptional()
  @IsString({ message: 'URL โลโก้ต้องเป็นข้อความ' })
  logoUrl?: string;
}

export class UpdateCompanyDto {
  @IsOptional()
  @IsString({ message: 'ชื่อบริษัท (ไทย) ต้องเป็นข้อความ' })
  nameTh?: string;

  @IsOptional()
  @IsString({ message: 'ชื่อบริษัท (อังกฤษ) ต้องเป็นข้อความ' })
  nameEn?: string;

  @IsOptional()
  @IsString({ message: 'เลขประจำตัวผู้เสียภาษีต้องเป็นข้อความ' })
  taxId?: string;

  // companyCode is immutable — cannot be changed via API (used as system identifier)

  @IsOptional()
  @IsString({ message: 'ที่อยู่ต้องเป็นข้อความ' })
  address?: string;

  @IsOptional()
  @IsString({ message: 'เบอร์โทรศัพท์ต้องเป็นข้อความ' })
  phone?: string;

  @IsOptional()
  @IsString({ message: 'ชื่อผู้มีอำนาจลงนามต้องเป็นข้อความ' })
  directorName?: string;

  @IsOptional()
  @IsString({ message: 'ตำแหน่งผู้มีอำนาจลงนามต้องเป็นข้อความ' })
  directorPosition?: string;

  @IsOptional()
  @IsBoolean({ message: 'สถานะจดทะเบียนภาษีมูลค่าเพิ่มต้องเป็น true หรือ false' })
  vatRegistered?: boolean;

  @IsOptional()
  @IsNumber({}, { message: 'อัตราภาษีมูลค่าเพิ่มต้องเป็นตัวเลข' })
  @Min(0, { message: 'อัตราภาษีมูลค่าเพิ่มต้องไม่ต่ำกว่า 0' })
  @Max(1, { message: 'อัตราภาษีมูลค่าเพิ่มต้องไม่เกิน 1' })
  vatRate?: number;

  @IsOptional()
  @IsString({ message: 'ชื่อธนาคารต้องเป็นข้อความ' })
  bankName?: string;

  @IsOptional()
  @IsString({ message: 'ชื่อบัญชีธนาคารต้องเป็นข้อความ' })
  bankAccountName?: string;

  @IsOptional()
  @IsString({ message: 'เลขบัญชีธนาคารต้องเป็นข้อความ' })
  bankAccountNumber?: string;

  @IsOptional()
  @IsString({ message: 'LINE OA ID ต้องเป็นข้อความ' })
  lineOaId?: string;

  @IsOptional()
  @IsString({ message: 'URL โลโก้ต้องเป็นข้อความ' })
  logoUrl?: string;
}
