import { z } from 'zod';

/**
 * Reusable Zod schemas สำหรับ validation ทั้งระบบ BESTCHOICE
 * ใช้คู่กับ React Hook Form + @hookform/resolvers/zod
 *
 * Usage:
 *   import { customerSchema } from '@/lib/schemas';
 *   const form = useForm({ resolver: zodResolver(customerSchema) });
 */

/* ─── Thai National ID validation (13 digits + checksum) ─── */
export function isValidThaiNationalId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(id[i]) * (13 - i);
  }
  const check = (11 - (sum % 11)) % 10;
  return check === parseInt(id[12]);
}

/* ─── Phone validation (Thai) ─── */
const thaiPhoneRegex = /^0[689]\d{8}$/;

/* ─── Shared field schemas ─── */
export const phoneSchema = z.string()
  .min(1, 'กรุณากรอกเบอร์โทร')
  .regex(thaiPhoneRegex, 'เบอร์โทรไม่ถูกต้อง (ตัวอย่าง: 0812345678)');

export const nationalIdSchema = z.string()
  .min(1, 'กรุณากรอกเลขบัตรประชาชน')
  .length(13, 'เลขบัตรต้องมี 13 หลัก')
  .refine(isValidThaiNationalId, 'เลขบัตรประชาชนไม่ถูกต้อง');

export const emailSchema = z.string()
  .email('อีเมลไม่ถูกต้อง')
  .or(z.literal(''));

/* ─── Customer schema ─── */
export const customerSchema = z.object({
  prefix: z.string().min(1, 'กรุณาเลือกคำนำหน้า'),
  firstName: z.string().min(1, 'กรุณากรอกชื่อ'),
  lastName: z.string().min(1, 'กรุณากรอกนามสกุล'),
  nickname: z.string().optional(),
  nationalId: nationalIdSchema,
  isForeigner: z.boolean().default(false),
  birthDate: z.string().optional(),
  phone: phoneSchema,
  phoneSecondary: z.string().optional(),
  email: emailSchema.optional(),
  lineId: z.string().optional(),
  facebookLink: z.string().url('URL ไม่ถูกต้อง').or(z.literal('')).optional(),
  facebookName: z.string().optional(),
  occupation: z.string().optional(),
  occupationDetail: z.string().optional(),
  salary: z.string().optional(),
  workplace: z.string().optional(),
});

export type CustomerFormData = z.infer<typeof customerSchema>;

/* ─── Product schema ─── */
export const productSchema = z.object({
  brand: z.string().min(1, 'กรุณากรอกยี่ห้อ'),
  model: z.string().min(1, 'กรุณากรอกรุ่น'),
  color: z.string().optional(),
  storage: z.string().optional(),
  imeiSerial: z.string().optional(),
  serialNumber: z.string().optional(),
  category: z.enum(['PHONE_NEW', 'PHONE_USED', 'TABLET_NEW', 'TABLET_USED', 'ACCESSORY'], {
    required_error: 'กรุณาเลือกประเภทสินค้า',
  }),
  costPrice: z.string().min(1, 'กรุณากรอกราคาทุน').refine(
    (v) => !isNaN(Number(v)) && Number(v) > 0,
    'ราคาทุนต้องมากกว่า 0',
  ),
  batteryHealth: z.string().optional(),
  warrantyExpireDate: z.string().optional(),
});

export type ProductFormData = z.infer<typeof productSchema>;

/* ─── Contract plan schema ─── */
export const contractPlanSchema = z.object({
  downPayment: z.number().min(0, 'เงินดาวน์ต้องไม่ติดลบ'),
  totalMonths: z.number().min(1, 'จำนวนงวดต้องอย่างน้อย 1').max(60, 'จำนวนงวดสูงสุด 60'),
  paymentDueDay: z.number().min(1).max(28, 'วันที่ชำระต้องระหว่าง 1-28'),
  notes: z.string().optional(),
});

export type ContractPlanFormData = z.infer<typeof contractPlanSchema>;

/* ─── Payment schema ─── */
export const paymentSchema = z.object({
  amount: z.number().positive('จำนวนเงินต้องมากกว่า 0'),
  paymentMethod: z.enum(['CASH', 'TRANSFER', 'DEBIT', 'CREDIT_CARD', 'PROMPTPAY', 'OTHER']),
  notes: z.string().optional(),
});

export type PaymentFormData = z.infer<typeof paymentSchema>;
