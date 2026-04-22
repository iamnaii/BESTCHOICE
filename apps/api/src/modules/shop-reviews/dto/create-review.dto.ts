import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateReviewDto {
  @IsUUID('4', { message: 'รหัสสินค้าต้องเป็น UUID' })
  productId!: string;

  @IsInt({ message: 'คะแนนต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'คะแนนต่ำสุดคือ 1' })
  @Max(5, { message: 'คะแนนสูงสุดคือ 5' })
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'หัวข้อรีวิวต้องไม่เกิน 200 ตัวอักษร' })
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'ความคิดเห็นต้องไม่เกิน 5000 ตัวอักษร' })
  comment?: string;
}
