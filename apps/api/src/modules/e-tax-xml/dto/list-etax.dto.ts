import { ETaxSubmissionStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query DTO for `GET /e-tax-xml` (list submissions).
 */
export class ListEtaxQueryDto {
  @IsOptional()
  @IsEnum(ETaxSubmissionStatus, {
    message: 'สถานะไม่ถูกต้อง',
  })
  status?: ETaxSubmissionStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'หน้าต้องเป็นเลขจำนวนเต็ม' })
  @Min(1, { message: 'หน้าต้องเริ่มจาก 1' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit ต้องเป็นเลขจำนวนเต็ม' })
  @Min(1, { message: 'limit ต้อง >= 1' })
  @Max(200, { message: 'limit สูงสุด 200' })
  limit?: number;
}
