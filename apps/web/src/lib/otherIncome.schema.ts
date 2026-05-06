import { z } from 'zod';

export const otherIncomeItemSchema = z.object({
  accountCode: z
    .string()
    .min(1, 'เลือกบัญชี')
    .regex(/^42-/, 'ต้องเป็นบัญชีกลุ่ม 42-XXXX'),
  description: z.string().optional(),
  quantity: z.coerce.number().min(0.01, 'จำนวน > 0'),
  unitAmount: z.coerce.number().min(0.01, 'ราคา > 0'),
  discountAmount: z.coerce.number().min(0).optional(),
  vatPct: z.coerce.number().min(0).max(100).optional(),
  whtPct: z.coerce.number().min(0).max(100).optional(),
});

export const otherIncomeAdjustmentSchema = z.object({
  accountCode: z.string().min(1, 'เลือกบัญชีปรับ'),
  amount: z.coerce.number().min(0.01, 'จำนวน > 0'),
  note: z.string().optional(),
});

export const otherIncomeFormSchema = z.object({
  issueDate: z.string().min(1, 'กรุณาระบุวันที่'),
  dueDate: z.string().optional(),
  paymentDate: z.string().optional(),
  priceType: z.enum(['EXCLUSIVE', 'INCLUSIVE']),
  customerId: z.string().uuid().optional().or(z.literal('')),
  counterpartyName: z.string().optional(),
  counterpartyTaxId: z.string().optional(),
  counterpartyAddress: z.string().optional(),
  counterpartyPhone: z.string().optional(),
  paymentAccountCode: z.string().min(1, 'เลือกช่องทางชำระ'),
  amountReceived: z.coerce.number().min(0, 'จำนวนเงิน ≥ 0'),
  items: z.array(otherIncomeItemSchema).min(1, 'อย่างน้อย 1 รายการ'),
  adjustments: z.array(otherIncomeAdjustmentSchema).optional(),
  customerNote: z.string().optional(),
});

export type OtherIncomeFormValues = z.infer<typeof otherIncomeFormSchema>;
