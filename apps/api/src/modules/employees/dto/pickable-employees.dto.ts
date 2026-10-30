import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * `GET /employees/pickable` — ตัวเลือกพนักงานของฟอร์มใบเงินเดือน.
 * `period` (Payroll D4 คำตัดสิน 8) = งวดของใบ ⇒ คนที่ลาออกตั้งแต่วันที่ 1 ของงวดนั้น (เวลาไทย) ยังเลือกได้
 * (ชุดเดียวกับที่ทางบันทึกใบเงินเดือนยอมรับ) · ไม่ส่ง = ซ่อนคนที่วันลาออกผ่านมาแล้วเหมือนเดิม
 */
export class PickableEmployeesQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(20\d{2})-(0[1-9]|1[0-2])$/, {
    message: 'รูปแบบงวดต้องเป็น YYYY-MM (ค.ศ. 2000-2099) — ห้ามใช้ พ.ศ.',
  })
  period?: string;
}
