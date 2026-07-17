import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';

export class CreateBuybackQuestionDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'key ต้องเป็น a-z 0-9 และ - เท่านั้น' })
  key!: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุหัวข้อคำถาม' })
  title!: string;

  @IsOptional()
  @IsString()
  helpText?: string;

  @IsIn(['SINGLE', 'MULTI'])
  selectType!: 'SINGLE' | 'MULTI';

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateBuybackQuestionDto {
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsString() helpText?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateBuybackChoiceDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุตัวเลือก' })
  label!: string;

  @IsIn(['PERCENT', 'FIXED'])
  deductType!: 'PERCENT' | 'FIXED';

  @IsNumber({}, { message: 'กรุณาระบุค่าหัก' })
  @Min(0, { message: 'ค่าหักต้องไม่ติดลบ' })
  deductValue!: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateBuybackChoiceDto {
  @IsOptional() @IsString() @IsNotEmpty() label?: string;
  @IsOptional() @IsIn(['PERCENT', 'FIXED']) deductType?: 'PERCENT' | 'FIXED';
  @IsOptional() @IsNumber() @Min(0) deductValue?: number;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
