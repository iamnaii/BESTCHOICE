import { IsIn, IsOptional } from 'class-validator';
import type { WorkQueueView } from '@installment/shared';
import { StaffInboxQueryDto } from './staff-inbox.dto';
export class ChatWorkQueryDto extends StaffInboxQueryDto {
  @IsOptional() @IsIn(['WAITING', 'UNASSIGNED', 'TODAY', 'OVERDUE', 'FOR_ME'])
  view: WorkQueueView = 'WAITING';
}
