import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Body of POST /overdue/mdm-requests/:id/approve.
 *
 * - `includeWallpaper` is optional. When omitted the service falls back to
 *   the proposer's choice stored on the MdmLockRequest row. When provided,
 *   the approver's value overrides (approver has authority to decide at
 *   approval time, not just at proposal time).
 */
export class ApproveMdmDto {
  @IsOptional()
  @IsBoolean({ message: 'ค่า includeWallpaper ต้องเป็น true/false' })
  includeWallpaper?: boolean;
}
