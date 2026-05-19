import { IsString, MinLength } from 'class-validator';

export class SendBackDto {
  @IsString()
  @MinLength(5, { message: 'ต้องระบุเหตุผล QC fail (อย่างน้อย 5 ตัวอักษร)' })
  note!: string;
}
