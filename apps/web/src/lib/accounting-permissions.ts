export const ACCOUNTING_PERMISSION_LABELS = {
  EXPENSE_POST: 'รายจ่าย: บันทึก & POST',
  EXPENSE_APPROVE: 'รายจ่าย: อนุมัติ',
  EXPENSE_CANCEL: 'รายจ่าย: ยกเลิก',
  INCOME_POST: 'รายรับ: บันทึก & POST',
  INCOME_APPROVE: 'รายรับ: อนุมัติ',
  INCOME_CANCEL: 'รายรับ: ยกเลิก',
} as const;
export type AccountingPermission = keyof typeof ACCOUNTING_PERMISSION_LABELS;
export const ACCOUNTING_PERMISSIONS = Object.keys(ACCOUNTING_PERMISSION_LABELS) as AccountingPermission[];
export interface AccountingPermissionsMe {
  user: { id: string; name: string; role: string; branchId: string | null };
  permissions: AccountingPermission[];
}
