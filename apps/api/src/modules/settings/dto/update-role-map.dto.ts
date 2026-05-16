import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * D1.1.1.3 — PATCH/PUT body for `PUT /settings/role-map/:id`. All fields
 * optional so the admin UI can update one column at a time. Note `role`
 * is intentionally NOT editable — it's the semantic key used by JE
 * templates and renaming it would orphan callers.
 */
export class UpdateRoleMapDto {
  @IsOptional()
  @IsString({ message: 'รหัสบัญชีต้องเป็นข้อความ' })
  @MaxLength(20, { message: 'รหัสบัญชีต้องไม่เกิน 20 ตัวอักษร' })
  accountCode?: string;

  @IsOptional()
  @IsInt({ message: 'ลำดับความสำคัญต้องเป็นเลขจำนวนเต็ม' })
  @Min(1, { message: 'ลำดับความสำคัญต้องมากกว่า 0' })
  priority?: number;

  @IsOptional()
  @IsBoolean({ message: 'สถานะใช้งานต้องเป็น true/false' })
  isActive?: boolean;

  @IsOptional()
  @IsString({ message: 'หมายเหตุต้องเป็นข้อความ' })
  @MaxLength(500, { message: 'หมายเหตุต้องไม่เกิน 500 ตัวอักษร' })
  note?: string | null;
}
