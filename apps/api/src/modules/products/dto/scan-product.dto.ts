import { IsString, Length } from 'class-validator';

/** `GET /products/scan?code=` — ค่าที่เครื่องยิงอ่านได้ (IMEI / รหัสสินค้าเดิม / id ของเครื่อง) */
export class ScanProductDto {
  @IsString({ message: 'กรุณาระบุรหัสที่ยิง' })
  @Length(1, 128, { message: 'กรุณาระบุรหัสที่ยิง' })
  code!: string;
}
