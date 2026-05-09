// Asset module — zod disposal-form schema (Phase 2)
// Conditional refines: when SALE → proceeds + depositAccountCode required.
// Server-side guards remain authoritative.

import { z } from 'zod/v4';

const CASH_ACCOUNT_CODES = [
  '11-1101',
  '11-1102',
  '11-1103',
  '11-1201',
  '11-1202',
  '11-1203',
] as const;

export const disposalSchema = z
  .object({
    disposalType: z.enum(['SALE', 'WRITE_OFF'], { error: 'กรุณาเลือกวิธีจำหน่าย' }),
    disposalDate: z.string().min(1, 'กรุณาระบุวันที่จำหน่าย'),
    proceeds: z.coerce.number().optional(),
    depositAccountCode: z.enum(CASH_ACCOUNT_CODES).optional(),
    reason: z.string().min(5, 'เหตุผลต้องมีอย่างน้อย 5 ตัวอักษร'),
  })
  .refine(
    (data) => data.disposalType !== 'SALE' || (data.proceeds !== undefined && data.proceeds > 0),
    { message: 'ราคาขายต้องมากกว่า 0', path: ['proceeds'] },
  )
  .refine((data) => data.disposalType !== 'SALE' || !!data.depositAccountCode, {
    message: 'กรุณาเลือกบัญชีรับเงิน',
    path: ['depositAccountCode'],
  })
  .refine((data) => new Date(data.disposalDate) <= new Date(), {
    message: 'วันที่จำหน่ายต้องไม่อยู่ในอนาคต',
    path: ['disposalDate'],
  });

export type DisposalFormValues = z.infer<typeof disposalSchema>;
