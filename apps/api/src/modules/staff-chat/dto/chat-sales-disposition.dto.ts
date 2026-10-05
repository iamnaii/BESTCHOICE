import { IsIn, IsUUID, ValidateIf } from 'class-validator';
import { JOURNEY_LOST_REASON_LABELS } from '@installment/shared';
export class ChatSalesDispositionDto {
  @IsIn(['MARK_LOST', 'REOPEN']) action!: 'MARK_LOST' | 'REOPEN';
  @ValidateIf((o) => o.action === 'MARK_LOST' || o.reason !== undefined)
  @IsIn(Object.keys(JOURNEY_LOST_REASON_LABELS))
  reason?: string;
  @IsUUID() clientRequestId!: string;
}
