import { IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import {
  JOURNEY_ENTRY_KINDS,
  JOURNEY_HEARD_FROM_CODES,
  JOURNEY_LOST_REASONS,
  JOURNEY_RECORDABLE_TOUCH_CHANNELS,
  JOURNEY_TOUCH_OUTCOMES,
  type JourneyHeardFrom,
  type JourneyLostReason,
  type JourneyManualEntryKind,
  type JourneyRecordableTouchChannel,
  type JourneyTouchOutcome,
} from '@installment/shared';

/**
 * POST /customers/:id/journey/entries — บันทึกมือแตะเดียว (ขอบเขต v2 คำตัดสินเจ้าของ 2026-09-15 ข้อ 4 และ 12)
 * ไม่มี note / occurredAt / roomId: ValidationPipe (whitelist) ตัดคีย์ที่ไม่มี decorator ทิ้ง · เวลาเป็นเวลาเซิร์ฟเวอร์เสมอ
 * ช่องของ kind อื่นที่ส่งมา (ValidateIf เป็นเท็จ) ไม่ถูกตรวจแต่ก็ไม่ถูกตัด ⇒ JourneyManualEntryService เขียนเฉพาะคอลัมน์ของ kind นั้น
 */
export class CreateJourneyEntryDto {
  @IsIn([...JOURNEY_ENTRY_KINDS.MANUAL], { message: 'ชนิดรายการไม่ถูกต้อง' })
  kind!: JourneyManualEntryKind;

  /** 4 ช่องทางที่พนักงานกดได้ — OTHER คงไว้เฉพาะป้ายของแถวเก่า */
  @ValidateIf((o: CreateJourneyEntryDto) => o.kind === 'TOUCHPOINT')
  @IsIn([...JOURNEY_RECORDABLE_TOUCH_CHANNELS], { message: 'กรุณาเลือกช่องทาง' })
  channel?: JourneyRecordableTouchChannel;

  @ValidateIf((o: CreateJourneyEntryDto) => o.kind === 'TOUCHPOINT')
  @IsIn([...JOURNEY_TOUCH_OUTCOMES], { message: 'กรุณาเลือกผลการติดต่อ' })
  outcome?: JourneyTouchOutcome;

  /** ชิปเหตุผลอย่างเดียว ไม่มีโน้ต */
  @ValidateIf((o: CreateJourneyEntryDto) => o.kind === 'MARKED_LOST')
  @IsIn([...JOURNEY_LOST_REASONS], { message: 'กรุณาเลือกเหตุผล' })
  lostReason?: JourneyLostReason;

  @ValidateIf((o: CreateJourneyEntryDto) => o.kind === 'HEARD_FROM')
  @IsIn([...JOURNEY_HEARD_FROM_CODES], { message: 'กรุณาเลือกช่องทางที่รู้จักร้าน' })
  heardFrom?: JourneyHeardFrom;

  /** UUID v4 ใหม่ทุกครั้งที่แตะ (เว็บใช้ uid()) ส่งซ้ำเฉพาะตอน retry ⇒ dedupe_key MANUAL:<kind>:<clientRequestId> */
  @IsOptional()
  @IsUUID('4', { message: 'รหัสคำขอไม่ถูกต้อง' })
  clientRequestId?: string;
}
