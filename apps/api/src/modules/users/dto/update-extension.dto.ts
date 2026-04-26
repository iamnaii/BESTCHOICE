import { IsOptional, IsString, Matches } from 'class-validator';

export class UpdateExtensionDto {
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{2,6}$/, { message: 'extension ต้องเป็นตัวเลข 2-6 หลัก' })
  extension?: string;
}
