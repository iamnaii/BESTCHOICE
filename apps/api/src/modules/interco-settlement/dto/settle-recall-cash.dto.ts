import { IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';
import {
  CASH_ACCOUNT_CODES,
  SHOP_CASH_ACCOUNT_CODES,
} from '../../../constants/cash-account.constants';

/**
 * เส้นทางรับเงินสดคืนจากยกเลิกสัญญา (Flow C-2 — Phase 3 Task 6, spec §5.4
 * ทางเลือกที่สองนอกจากหักกลบรอบจ่าย):
 * `POST /interco-settlement/recalls/:contractId/settle-cash`.
 *
 * FINANCE: `Dr <financeDepositAccountCode> / Cr 11-2107` (stamp PAYOUT_RECALL)
 * SHOP:    `Dr S21-3001 / Cr <shopPayoutAccountCode>` — สองใบใน tx เดียว.
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

  /** บัญชีเงินสด/ธนาคารฝั่ง SHOP ที่จ่ายเงินออก — default 'S11-1201' ที่ service */
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
