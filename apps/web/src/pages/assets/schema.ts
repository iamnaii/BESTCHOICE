// Asset module — zod entry-form schema (Phase 1)
// V1-V14 client-side validation. Server-side guards remain authoritative.

import { z } from 'zod/v4';

export const assetEntrySchema = z
  .object({
    // Section 1 — basic identification
    name: z.string().min(1, 'กรุณาระบุชื่อสินทรัพย์').max(150),
    description: z.string().optional(),
    category: z.enum(['EQUIPMENT', 'IMPROVEMENT', 'FURNITURE', 'VEHICLE'], {
      error: 'กรุณาเลือกหมวดหมู่',
    }),
    branchId: z.string().optional(),
    custodian: z.string().optional(),
    location: z.string().optional(),
    serialNo: z.string().optional(),
    warrantyExpire: z.string().optional(),

    // Section 2 — pricing / VAT / WHT / depreciation
    // Line-item inputs (expense-style). basePrice is derived = qty × unitPrice − discount.
    quantity: z.coerce.number().min(0).optional().default(1),
    unitPrice: z.coerce.number().min(0).optional().default(0),
    discount: z.coerce.number().min(0).optional().default(0),
    basePrice: z.coerce.number().positive('ราคาต้องมากกว่า 0'),
    shippingCost: z.coerce.number().min(0).optional().default(0),
    installationCost: z.coerce.number().min(0).optional().default(0),
    otherCapitalized: z.coerce.number().min(0).optional().default(0),
    hasVat: z.boolean().default(false),
    vatInclusive: z.boolean().default(false),
    vatAccount: z.enum(['11-4101', '11-4102']).optional(),
    hasWht: z.boolean().default(false),
    whtBaseAmount: z.coerce.number().min(0).optional(),
    whtRate: z.coerce.number().min(0).max(0.05, 'อัตรา WHT ต้องไม่เกิน 5%').optional(),
    whtAccount: z.enum(['21-3102', '21-3103']).optional(),
    whtFormType: z.enum(['PND3', 'PND53']).optional(),
    residualValue: z.coerce.number().min(0).optional().default(0),
    usefulLifeMonths: z.coerce.number().int().min(1, 'อายุการใช้งานต้องมากกว่า 0 เดือน'),

    // Section 3 — purchase / supplier / payment
    purchaseDate: z.string().min(1, 'กรุณาระบุวันที่ซื้อ'),
    invoiceDate: z.string().optional(),
    supplierName: z.string().optional(),
    supplierTaxId: z.string().optional(),
    // P6: optional FK to Supplier master + partial-payment amount.
    vendorId: z.string().uuid().optional(),
    vendorAmountPaid: z.coerce
      .number()
      .nonnegative('จำนวนเงินที่จ่ายต้องไม่เป็นค่าลบ')
      .max(99999999.99, 'จำนวนเงินที่จ่ายเกินขีดจำกัด')
      .optional(),
    invoiceNo: z.string().optional(),
    taxInvoiceNo: z.string().optional(),
    paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'QR_EWALLET']).optional(),
    paymentAccount: z.string().min(1, 'กรุณาเลือกบัญชีจ่ายเงิน'),

    // Section 5 — approval / note
    approverId: z.string().optional(),
    note: z.string().optional(),
    // PR 2a Task 6 (P7) — Permission settings (UI-only metadata; API enforcement
    // deferred). Replaces the single-approver dropdown. Backend backfills from
    // legacy `approverId` for callers that haven't migrated.
    permissionConfig: z
      .array(
        z.object({
          userId: z.string().uuid(),
          canView: z.boolean(),
          canEdit: z.boolean(),
          canPost: z.boolean(),
        }),
      )
      .default([]),
  })
  .refine((data) => !data.hasVat || !!data.vatAccount, {
    message: 'กรุณาเลือกบัญชี VAT',
    path: ['vatAccount'],
  })
  .refine((data) => !data.hasWht || (!!data.whtAccount && data.whtRate !== undefined), {
    message: 'กรุณาเลือกบัญชี WHT และอัตรา',
    path: ['whtAccount'],
  })
  .refine((data) => (data.residualValue ?? 0) <= data.basePrice, {
    message: 'มูลค่าซากต้องไม่เกินราคา',
    path: ['residualValue'],
  })
  // NOTE: anchored to local browser time. Server re-validates via V11 (purchaseDate ≤ today).
  .refine((data) => new Date(data.purchaseDate) <= new Date(), {
    message: 'วันที่ซื้อต้องไม่อยู่ในอนาคต',
    path: ['purchaseDate'],
  })
  .refine(
    (data) => !data.paymentMethod || data.paymentMethod === 'CASH' || !!data.supplierName,
    { message: 'กรุณาระบุชื่อผู้ขาย', path: ['supplierName'] },
  );

export type AssetEntryFormValues = z.infer<typeof assetEntrySchema>;
