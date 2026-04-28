import { IsIn, IsString, MinLength, MaxLength } from 'class-validator';

export const ESCALATION_ACTIONS = ['LETTER', 'MDM', 'LEGAL'] as const;
export type EscalationAction = (typeof ESCALATION_ACTIONS)[number];

export class EscalateDto {
  @IsIn(ESCALATION_ACTIONS, { message: 'action ต้องเป็น LETTER, MDM หรือ LEGAL' })
  action!: EscalationAction;

  @IsString()
  @MinLength(5, { message: 'ระบุเหตุผล (≥ 5 ตัวอักษร)' })
  @MaxLength(500)
  reason!: string;
}
