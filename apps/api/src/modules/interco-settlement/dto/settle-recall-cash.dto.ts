import { IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';
import {
  CASH_ACCOUNT_CODES,
  SHOP_CASH_ACCOUNT_CODES,
} from '../../../constants/cash-account.constants';

/**
 * เส้นทางรับเงินสดล้างลูกหนี้-หน้าร้านประเภทหัก — ใช้ร่วมสองเส้นทาง:
 *   - `POST /interco-settlement/recalls/:contractId/settle-cash` (Flow C-2 — Phase 3 Task 6,
 *     spec §5.4 ทางเลือกที่สองนอกจากหักกลบรอบจ่าย; stamp PAYOUT_RECALL; default บัญชีจ่าย SHOP S11-1201)
 *   - `POST /interco-settlement/device-returns/:contractId/settle-cash` (ใบรับเครื่องคืน 2026-09-20
 *     §6.3; stamp DEVICE_RETURN; default บัญชีจ่าย SHOP S11-1202)
 *
 * FINANCE: `Dr <financeDepositAccountCode> / Cr 11-2107` (stamp ตามประเภท)
 * SHOP:    `Dr S21-1104 / Cr <shopPayoutAccountCode>` — สองใบใน tx เดียว.
 */
export class SettleRecallCashDto {
  /** ยอดรับคืน (฿) — ต้องมากกว่า 0 และไม่เกินยอดเรียกคืนสุทธิคงเหลือของสัญญา */
  @IsNumber({}, { message: 'ยอดรับเงินคืนต้องเป็นตัวเลข' })
  @IsPositive({ message: 'ยอดรับเงินคืนต้องมากกว่า 0' })
  amount!: number;

  /** บัญชีเงินสด/ธนาคารฝั่ง FINANCE ที่รับเงินคืน */
  @IsString({ message: 'financeDepositAccountCode ต้องเป็นข้อความ' })
  @IsIn(CASH_ACCOUNT_CODES as readonly string[], {
    message: `บัญชีรับเงินฝั่ง FINANCE ต้องเป็นหนึ่งใน ${CASH_ACCOUNT_CODES.join(', ')}`,
  })
  financeDepositAccountCode!: string;

  /** บัญชีเงินสด/ธนาคารฝั่ง SHOP ที่จ่ายเงินออก — default recall 'S11-1201' / DEVICE_RETURN 'S11-1202' ที่ service */
  @IsOptional()
  @IsString({ message: 'shopPayoutAccountCode ต้องเป็นข้อความ' })
  @IsIn(SHOP_CASH_ACCOUNT_CODES as readonly string[], {
    message: `บัญชีจ่ายเงินฝั่ง SHOP ต้องเป็นหนึ่งใน ${SHOP_CASH_ACCOUNT_CODES.join(', ')}`,
  })
  shopPayoutAccountCode?: string;

  /** ไอดีคำขอจากหน้าจอ — กัน retry ซ้ำโดยไม่กลืนการรับคืนซ้ำยอดเท่ากันที่ตั้งใจ */
  @IsUUID(4, { message: 'requestId ไม่ถูกต้อง' })
  requestId!: string;
}
