export const PAYMENT_APPROVAL_PERMISSION_LABELS = {
  WAIVE_LATE_FEE: 'ยกเว้นค่าปรับ',
  PAYMENT_TOLERANCE: 'อนุโลมยอดชำระ',
  VOID_RECEIPT: 'ยกเลิกใบเสร็จ',
  EARLY_PAYOFF: 'ส่วนลดปิดสัญญา',
  REFUND: 'อนุมัติคืนเงินเข้าบัญชี',
} as const;

export type PaymentApprovalPermission = keyof typeof PAYMENT_APPROVAL_PERMISSION_LABELS;
export const PAYMENT_APPROVAL_PERMISSIONS = Object.keys(PAYMENT_APPROVAL_PERMISSION_LABELS) as PaymentApprovalPermission[];

export interface PaymentApprovalPermissionsMe {
  user: { id: string; name: string; role: string; branchId: string | null };
  permissions: PaymentApprovalPermission[];
}
