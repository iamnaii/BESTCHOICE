import { IsOptional, IsUUID } from 'class-validator';

export class AssignDto {
  @IsUUID()
  assignmentId: string;

  @IsOptional()
  @IsUUID()
  toCollectorId?: string;
}
