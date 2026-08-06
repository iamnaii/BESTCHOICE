import { IsIn, IsString } from 'class-validator';

/**
 * Phase 3 CN Task 5 — manual issue endpoint request body.
 * Covers the "JE exists but the CN document was never created" case (e.g. a
 * JE posted before the auto-issue wiring shipped, or a prior attempt that
 * failed after the JE committed but before the CN document did).
 */
export class IssueCreditNoteDto {
  @IsString({ message: 'กรุณาระบุรหัสสัญญา' })
  contractId: string;

  @IsIn(['REPOSSESSION', 'WRITE_OFF'], {
    message: 'กรุณาระบุแหล่งที่มาเป็น REPOSSESSION หรือ WRITE_OFF',
  })
  source: 'REPOSSESSION' | 'WRITE_OFF';
}
