import {
  IsString,
  IsNotEmpty,
  IsNumberString,
  IsIn,
  IsOptional,
} from 'class-validator';

/**
 * Single adjustment row for an ExpenseDocument's diff between cash leg
 * actually paid and `totalAmount − wht`. See ExpenseAdjustment model docs
 * (schema.prisma) for the V12/V13/V14 rules.
 */
export class ExpenseAdjustmentInput {
  /** CoA code where the adjustment posts (e.g. 53-1503 ปัดเศษ, 52-1104 ส่วนลด). */
  @IsString()
  @IsNotEmpty({ message: 'V13: บัญชีปรับผลต่างต้องไม่ว่าง' })
  accountCode!: string;

  @IsString()
  @IsIn(['DR', 'CR'], { message: 'side ต้องเป็น "DR" หรือ "CR"' })
  side!: 'DR' | 'CR';

  /**
   * Always positive — direction is carried by `side`. V14 enforces > 0
   * server-side; class-validator only ensures string-numeric shape here.
   */
  @IsNumberString({ no_symbols: true })
  amount!: string;

  @IsString()
  @IsOptional()
  note?: string;
}
