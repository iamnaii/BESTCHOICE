import { IsInt, IsObject, IsString, Max, Min } from 'class-validator';

export class SaveStaffNotifyRulesDto {
  /** `{ [eventKey]: { enabled, roles, branchScoped, includeGroup } }` — ตรวจละเอียดใน StaffNotifyRulesService.validateRules */
  @IsObject({ message: 'รูปแบบกติกาไม่ถูกต้อง' })
  rules!: Record<string, unknown>;
}

export class SaveStaffNotifyCapDto {
  @IsInt({ message: 'เพดานข้อความต่อเดือนต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'เพดานข้อความต่อเดือนต้องเป็นจำนวนเต็ม 1–100000' })
  @Max(100_000, { message: 'เพดานข้อความต่อเดือนต้องเป็นจำนวนเต็ม 1–100000' })
  cap!: number;
}

export class TestStaffEventDto {
  @IsString()
  eventKey!: string;
}
