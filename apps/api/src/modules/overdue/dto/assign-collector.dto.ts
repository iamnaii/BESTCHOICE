import { IsString, IsOptional } from 'class-validator';

export class AssignCollectorDto {
  @IsOptional()
  @IsString({ message: 'assignedToId ต้องเป็น string' })
  assignedToId?: string;

  /**
   * @deprecated Frontend historically posts `userId`; canonical is `assignedToId`.
   * Accepted for one release during migration. Remove after Plan 2.
   */
  @IsOptional()
  @IsString({ message: 'userId ต้องเป็น string' })
  userId?: string;
}
