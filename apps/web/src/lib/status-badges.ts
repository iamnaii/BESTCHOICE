/**
 * Centralized status badge configuration.
 * Maps every status enum to a Badge variant + Thai label so all pages
 * show consistent colours without inline className strings.
 *
 * Usage:
 *   import { getStatusBadgeProps, contractStatusMap } from '@/lib/status-badges';
 *   const cfg = getStatusBadgeProps(contract.status, contractStatusMap);
 *   <Badge variant={cfg.variant} appearance={cfg.appearance}>{cfg.label}</Badge>
 */

import type { VariantProps } from 'class-variance-authority';
import type { badgeVariants } from '@/components/ui/badge';

export interface StatusConfig {
  variant: VariantProps<typeof badgeVariants>['variant'];
  appearance?: VariantProps<typeof badgeVariants>['appearance'];
  label: string;
}

// ─── Contract statuses ───────────────────────────────────────────────────────

export const contractStatusMap: Record<string, StatusConfig> = {
  DRAFT: { variant: 'secondary', label: 'ร่าง' },
  ACTIVE: { variant: 'success', appearance: 'light', label: 'ผ่อนอยู่' },
  OVERDUE: { variant: 'warning', appearance: 'light', label: 'ค้างชำระ' },
  DEFAULT: { variant: 'destructive', appearance: 'light', label: 'ผิดนัด' },
  EARLY_PAYOFF: { variant: 'primary', appearance: 'light', label: 'ปิดก่อนกำหนด' },
  COMPLETED: { variant: 'success', appearance: 'light', label: 'ครบกำหนด' },
  EXCHANGED: { variant: 'info', appearance: 'light', label: 'เปลี่ยนเครื่อง' },
  CLOSED_BAD_DEBT: { variant: 'destructive', label: 'ตัดหนี้สูญ' },
};

// ─── Payment statuses ─────────────────────────────────────────────────────────

export const paymentStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'secondary', label: 'รอชำระ' },
  PAID: { variant: 'success', appearance: 'light', label: 'ชำระแล้ว' },
  PARTIALLY_PAID: { variant: 'warning', appearance: 'light', label: 'ชำระบางส่วน' },
  OVERDUE: { variant: 'destructive', appearance: 'light', label: 'ค้างชำระ' },
};

// ─── Dunning stages ───────────────────────────────────────────────────────────

export const dunningStageMap: Record<string, StatusConfig> = {
  NONE: { variant: 'secondary', label: 'ปกติ' },
  REMINDER: { variant: 'warning', appearance: 'light', label: 'แจ้งเตือน' },
  NOTICE: { variant: 'warning', label: 'แจ้งค้างชำระ' },
  FINAL_WARNING: { variant: 'destructive', appearance: 'light', label: 'เตือนครั้งสุดท้าย' },
  LEGAL_ACTION: { variant: 'destructive', label: 'ดำเนินคดี' },
};

// ─── Collection stages ────────────────────────────────────────────────────────

export const collectionStageMap: Record<string, StatusConfig> = {
  NORMAL: { variant: 'secondary', label: 'ปกติ' },
  REMINDED: { variant: 'warning', appearance: 'light', label: 'แจ้งเตือนแล้ว' },
  OVERDUE: { variant: 'warning', label: 'ค้างชำระ' },
  CONTACTED: { variant: 'info', appearance: 'light', label: 'ติดต่อแล้ว' },
  PROMISE_TO_PAY: { variant: 'info', label: 'สัญญาจ่าย' },
  ESCALATED_FM: { variant: 'destructive', appearance: 'light', label: 'ส่งผจก.การเงิน' },
  MDM_LOCKED: { variant: 'destructive', label: 'ล็อคเครื่องแล้ว' },
  REPOSSESSION: { variant: 'destructive', label: 'ยึดเครื่องแล้ว' },
};

// ─── Finance receivable statuses ──────────────────────────────────────────────

export const financeReceivableStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอรับเงิน' },
  PARTIALLY_RECEIVED: { variant: 'warning', label: 'ได้รับบางส่วน' },
  RECEIVED: { variant: 'success', appearance: 'light', label: 'ได้รับแล้ว' },
  OVERDUE: { variant: 'destructive', appearance: 'light', label: 'เกินกำหนด' },
  DISPUTED: { variant: 'destructive', label: 'มีปัญหา' },
};

// ─── Inter-company transaction statuses ──────────────────────────────────────

export const interCompanyStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอดำเนินการ' },
  CONFIRMED: { variant: 'primary', appearance: 'light', label: 'ยืนยันแล้ว' },
  RECONCILED: { variant: 'success', appearance: 'light', label: 'กระทบยอดแล้ว' },
};

// ─── Stock transfer statuses ──────────────────────────────────────────────────

export const transferStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอจัดส่ง' },
  IN_TRANSIT: { variant: 'info', appearance: 'light', label: 'ระหว่างโอนสินค้า' },
  CONFIRMED: { variant: 'success', appearance: 'light', label: 'รับแล้ว' },
  REJECTED: { variant: 'destructive', appearance: 'light', label: 'ปฏิเสธ' },
};

// ─── Product statuses ─────────────────────────────────────────────────────────

export const productStatusMap: Record<string, StatusConfig> = {
  PO_RECEIVED: { variant: 'primary', appearance: 'light', label: 'รับจาก PO' },
  QC_PENDING: { variant: 'warning', appearance: 'light', label: 'รอตรวจรับ' },
  PHOTO_PENDING: { variant: 'primary', appearance: 'light', label: 'รอถ่ายรูป' },
  INSPECTION: { variant: 'warning', label: 'กำลังตรวจ' },
  IN_STOCK: { variant: 'success', appearance: 'light', label: 'พร้อมขาย' },
  RESERVED: { variant: 'info', appearance: 'light', label: 'จอง' },
  SOLD_INSTALLMENT: { variant: 'primary', label: 'ขายผ่อน' },
  SOLD_CASH: { variant: 'success', label: 'ขายสด' },
  REPOSSESSED: { variant: 'destructive', appearance: 'light', label: 'ยึดคืน' },
  REFURBISHED: { variant: 'warning', label: 'ซ่อมแล้ว' },
  SOLD_RESELL: { variant: 'info', label: 'ขายต่อ' },
  DAMAGED: { variant: 'destructive', appearance: 'light', label: 'เสียหาย' },
  LOST: { variant: 'destructive', label: 'สูญหาย' },
  WRITTEN_OFF: { variant: 'secondary', label: 'ตัดจำหน่าย' },
};

// ─── Credit check statuses ───────────────────────────────────────────────────

export const creditCheckStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'secondary', label: 'รอวิเคราะห์' },
  APPROVED: { variant: 'success', appearance: 'light', label: 'ผ่าน' },
  REJECTED: { variant: 'destructive', appearance: 'light', label: 'ไม่ผ่าน' },
  MANUAL_REVIEW: { variant: 'warning', appearance: 'light', label: 'ต้องตรวจเพิ่ม' },
};

// ─── Repossession statuses ────────────────────────────────────────────────────

export const repossessionStatusMap: Record<string, StatusConfig> = {
  REPOSSESSED: { variant: 'destructive', appearance: 'light', label: 'ยึดคืนแล้ว' },
  UNDER_REPAIR: { variant: 'warning', appearance: 'light', label: 'กำลังซ่อม' },
  READY_FOR_SALE: { variant: 'success', appearance: 'light', label: 'พร้อมขาย' },
  SOLD: { variant: 'primary', appearance: 'light', label: 'ขายแล้ว' },
};

// ─── Condition grades ─────────────────────────────────────────────────────────

export const conditionGradeMap: Record<string, StatusConfig> = {
  A: { variant: 'success', appearance: 'light', label: 'เกรด A' },
  B: { variant: 'primary', appearance: 'light', label: 'เกรด B' },
  C: { variant: 'warning', appearance: 'light', label: 'เกรด C' },
  D: { variant: 'destructive', appearance: 'light', label: 'เกรด D' },
};

// ─── Risk levels ──────────────────────────────────────────────────────────────

export const riskLevelMap: Record<string, StatusConfig> = {
  HIGH: { variant: 'destructive', appearance: 'light', label: 'สูง' },
  MEDIUM: { variant: 'warning', appearance: 'light', label: 'กลาง' },
  LOW: { variant: 'warning', label: 'ต่ำ' },
};

// ─── Purchase Order statuses ─────────────────────────────────────────────────

export const poStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'secondary', label: 'รอดำเนินการ' },
  DRAFT: { variant: 'warning', appearance: 'light', label: 'รออนุมัติ' },
  APPROVED: { variant: 'primary', appearance: 'light', label: 'อนุมัติแล้ว' },
  PARTIALLY_RECEIVED: { variant: 'warning', appearance: 'light', label: 'รับบางส่วน' },
  FULLY_RECEIVED: { variant: 'success', appearance: 'light', label: 'รับครบแล้ว' },
  CANCELLED: { variant: 'destructive', appearance: 'light', label: 'ยกเลิก' },
};

// ─── Purchase Order payment statuses ─────────────────────────────────────────

export const poPaymentStatusMap: Record<string, StatusConfig> = {
  UNPAID: { variant: 'destructive', appearance: 'light', label: 'ยังไม่จ่าย' },
  DEPOSIT_PAID: { variant: 'warning', appearance: 'light', label: 'จ่ายมัดจำ' },
  PARTIALLY_PAID: { variant: 'primary', appearance: 'light', label: 'จ่ายบางส่วน' },
  FULLY_PAID: { variant: 'success', appearance: 'light', label: 'จ่ายครบแล้ว' },
};

// ─── Stock count statuses ────────────────────────────────────────────────────

export const stockCountStatusMap: Record<string, StatusConfig> = {
  DRAFT: { variant: 'secondary', label: 'ร่าง' },
  IN_PROGRESS: { variant: 'warning', appearance: 'light', label: 'กำลังตรวจนับ' },
  COMPLETED: { variant: 'success', appearance: 'light', label: 'เสร็จสิ้น' },
  CANCELLED: { variant: 'destructive', appearance: 'light', label: 'ยกเลิก' },
};

// ─── Inspection / QC statuses ────────────────────────────────────────────────

export const inspectionStatusMap: Record<string, StatusConfig> = {
  RECEIVED: { variant: 'info', appearance: 'light', label: 'รอตรวจ' },
  INSPECTING: { variant: 'warning', appearance: 'light', label: 'กำลังตรวจ' },
  QC_PASSED: { variant: 'success', appearance: 'light', label: 'ผ่าน QC' },
  QC_FAILED: { variant: 'destructive', appearance: 'light', label: 'ไม่ผ่าน QC' },
  IN_STOCK: { variant: 'primary', appearance: 'light', label: 'เข้าสต็อกแล้ว' },
};

// ─── Stock alert statuses ────────────────────────────────────────────────────

export const stockAlertStatusMap: Record<string, StatusConfig> = {
  ACTIVE: { variant: 'destructive', appearance: 'light', label: 'ต้องดำเนินการ' },
  PO_CREATED: { variant: 'primary', appearance: 'light', label: 'สร้าง PO แล้ว' },
  RESOLVED: { variant: 'success', appearance: 'light', label: 'แก้ไขแล้ว' },
};

// ─── Stock adjustment reasons ─────────────────────────────────────────────────

export const stockAdjustmentReasonMap: Record<string, StatusConfig> = {
  DAMAGED: { variant: 'destructive', appearance: 'light', label: 'เสียหาย' },
  LOST: { variant: 'warning', appearance: 'light', label: 'สูญหาย' },
  FOUND: { variant: 'success', appearance: 'light', label: 'พบเพิ่ม' },
  CORRECTION: { variant: 'primary', appearance: 'light', label: 'แก้ไขข้อมูล' },
  WRITE_OFF: { variant: 'secondary', label: 'ตัดจำหน่าย' },
  OTHER: { variant: 'secondary', label: 'อื่นๆ' },
};

// ─── Session / chat statuses ─────────────────────────────────────────────────

export const sessionStatusMap: Record<string, StatusConfig> = {
  OPEN: { variant: 'success', appearance: 'light', label: 'เปิด' },
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอ' },
  HANDOFF: { variant: 'destructive', appearance: 'light', label: 'ส่งต่อ' },
  RESOLVED: { variant: 'secondary', label: 'จบ' },
  ARCHIVED: { variant: 'secondary', label: 'เก็บ' },
};

// ─── Session / message priority ──────────────────────────────────────────────

export const sessionPriorityMap: Record<string, StatusConfig> = {
  CRITICAL: { variant: 'destructive', label: 'CRITICAL' },
  HIGH: { variant: 'warning', label: 'HIGH' },
  NORMAL: { variant: 'secondary', label: 'ปกติ' },
  LOW: { variant: 'secondary', label: 'ต่ำ' },
};

// ─── Chatbot KB response types ────────────────────────────────────────────────

export const kbResponseTypeMap: Record<string, StatusConfig> = {
  handoff: { variant: 'warning', appearance: 'light', label: 'handoff' },
  info: { variant: 'info', appearance: 'light', label: 'info' },
  auto: { variant: 'success', appearance: 'light', label: 'auto' },
};

// ─── Chatbot suggestion / KB suggestion statuses ──────────────────────────────

export const kbSuggestionStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอตรวจสอบ' },
  APPROVED: { variant: 'success', appearance: 'light', label: 'อนุมัติแล้ว' },
  REJECTED: { variant: 'secondary', label: 'ปฏิเสธแล้ว' },
};

// ─── Chatbot suggestion source ────────────────────────────────────────────────

export const kbSuggestionSourceMap: Record<string, StatusConfig> = {
  handoff: { variant: 'warning', appearance: 'light', label: 'Handoff' },
  low_rating: { variant: 'destructive', appearance: 'light', label: 'Feedback 👎' },
  auto_analysis: { variant: 'info', appearance: 'light', label: 'Auto' },
};

// ─── Accounting period statuses ───────────────────────────────────────────────

export const accountingPeriodStatusMap: Record<string, StatusConfig> = {
  OPEN: { variant: 'secondary', label: 'เปิด' },
  REVIEW: { variant: 'warning', appearance: 'light', label: 'รีวิว' },
  CLOSED: { variant: 'primary', appearance: 'light', label: 'ปิดแล้ว' },
  SYNCED: { variant: 'success', appearance: 'light', label: 'Sync แล้ว' },
  // Tax report statuses
  DRAFT: { variant: 'warning', appearance: 'light', label: 'แบบร่าง' },
  GENERATED: { variant: 'primary', appearance: 'light', label: 'สร้างแล้ว' },
  SUBMITTED: { variant: 'success', appearance: 'light', label: 'ยื่นแล้ว' },
};

// ─── Generic active/inactive ──────────────────────────────────────────────────

export const activeStatusMap: Record<string, StatusConfig> = {
  active: { variant: 'success', appearance: 'light', label: 'Active' },
  inactive: { variant: 'secondary', label: 'Inactive' },
  configured: { variant: 'success', appearance: 'light', label: 'ตั้งค่าแล้ว' },
  not_configured: { variant: 'destructive', appearance: 'light', label: 'ยังไม่ได้ตั้งค่า' },
};

// ─── Audit log action types ──────────────────────────────────────────────────

export const auditActionMap: Record<string, StatusConfig> = {
  CREATE: { variant: 'success', appearance: 'light', label: 'สร้าง' },
  UPDATE: { variant: 'primary', appearance: 'light', label: 'แก้ไข' },
  DELETE: { variant: 'destructive', appearance: 'light', label: 'ลบ' },
  LOGIN: { variant: 'info', appearance: 'light', label: 'เข้าสู่ระบบ' },
  LOGOUT: { variant: 'secondary', label: 'ออกจากระบบ' },
  EXPORT: { variant: 'warning', appearance: 'light', label: 'ส่งออก' },
  // Financial audit action types
  PAYMENT_RECORDED: { variant: 'success', appearance: 'light', label: 'บันทึกชำระเงิน' },
  PAYMENT_PARTIAL: { variant: 'info', appearance: 'light', label: 'ชำระบางส่วน' },
  LATE_FEE_WAIVED: { variant: 'warning', appearance: 'light', label: 'ยกเว้นค่าปรับ' },
  CREDIT_APPLIED: { variant: 'info', appearance: 'light', label: 'ใช้เครดิต' },
  RECEIPT_GENERATED: { variant: 'success', appearance: 'light', label: 'ออกใบเสร็จ' },
  RECEIPT_VOIDED: { variant: 'destructive', appearance: 'light', label: 'ยกเลิกใบเสร็จ' },
  CREDIT_NOTE_ISSUED: { variant: 'warning', appearance: 'light', label: 'ออกใบลดหนี้' },
  OVERPAYMENT_CREDITED: { variant: 'primary', appearance: 'light', label: 'บันทึกเครดิตเกิน' },
  CREDIT_BALANCE_APPLIED: { variant: 'info', appearance: 'light', label: 'ใช้ยอดเครดิต' },
  CONTRACT_COMPLETED: { variant: 'success', appearance: 'light', label: 'ปิดสัญญา' },
  DUNNING_ESCALATION: { variant: 'destructive', appearance: 'light', label: 'ยกระดับติดตามหนี้' },
  STATUS_CHANGE: { variant: 'secondary', label: 'เปลี่ยนสถานะ' },
};

// ─── User / branch active status ──────────────────────────────────────────────

export const enabledStatusMap: Record<string, StatusConfig> = {
  true: { variant: 'success', appearance: 'light', label: 'ใช้งาน' },
  false: { variant: 'secondary', label: 'ปิดใช้งาน' },
};

// ─── Commission statuses ──────────────────────────────────────────────────────

export const commissionStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอจ่าย' },
  PAID: { variant: 'success', appearance: 'light', label: 'จ่ายแล้ว' },
  CANCELLED: { variant: 'destructive', appearance: 'light', label: 'ยกเลิก' },
};

// ─── Expense statuses ──────────────────────────────────────────────────────────

export const expenseStatusMap: Record<string, StatusConfig> = {
  DRAFT: { variant: 'secondary', label: 'ร่าง' },
  PENDING: { variant: 'warning', appearance: 'light', label: 'รออนุมัติ' },
  PENDING_APPROVAL: { variant: 'warning', appearance: 'light', label: 'รออนุมัติ' },
  APPROVED: { variant: 'success', appearance: 'light', label: 'อนุมัติแล้ว' },
  REJECTED: { variant: 'destructive', appearance: 'light', label: 'ไม่อนุมัติ' },
  PAID: { variant: 'primary', appearance: 'light', label: 'จ่ายแล้ว' },
  VOIDED: { variant: 'secondary', label: 'ยกเลิก' },
};

// ─── Exchange statuses ────────────────────────────────────────────────────────

export const exchangeStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอดำเนินการ' },
  COMPLETED: { variant: 'success', appearance: 'light', label: 'เสร็จสิ้น' },
  CANCELLED: { variant: 'destructive', appearance: 'light', label: 'ยกเลิก' },
};

// ─── Promotion statuses ───────────────────────────────────────────────────────

export const promotionStatusMap: Record<string, StatusConfig> = {
  ACTIVE: { variant: 'success', appearance: 'light', label: 'ใช้งาน' },
  SCHEDULED: { variant: 'info', appearance: 'light', label: 'รอเริ่ม' },
  EXPIRED: { variant: 'secondary', label: 'หมดอายุ' },
  DRAFT: { variant: 'warning', appearance: 'light', label: 'ร่าง' },
};

// ─── Trade-in statuses ────────────────────────────────────────────────────────

export const tradeInStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอประเมิน' },
  PENDING_APPRAISAL: { variant: 'warning', appearance: 'light', label: 'รอประเมิน' },
  APPRAISED: { variant: 'info', appearance: 'light', label: 'ประเมินแล้ว' },
  ACCEPTED: { variant: 'success', appearance: 'light', label: 'รับซื้อ' },
  REJECTED: { variant: 'destructive', appearance: 'light', label: 'ไม่รับซื้อ' },
  COMPLETED: { variant: 'primary', appearance: 'light', label: 'เสร็จสิ้น' },
};

// ─── Receipt statuses ─────────────────────────────────────────────────────────

export const receiptStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอตรวจสอบ' },
  VERIFIED: { variant: 'success', appearance: 'light', label: 'ตรวจแล้ว' },
  REJECTED: { variant: 'destructive', appearance: 'light', label: 'ไม่ผ่าน' },
};

// ─── Notification channel types ───────────────────────────────────────────────

export const notificationChannelMap: Record<string, StatusConfig> = {
  LINE: { variant: 'success', appearance: 'light', label: 'LINE' },
  SMS: { variant: 'info', appearance: 'light', label: 'SMS' },
  EMAIL: { variant: 'primary', appearance: 'light', label: 'Email' },
  PUSH: { variant: 'warning', appearance: 'light', label: 'Push' },
};

// ─── Webhook statuses ─────────────────────────────────────────────────────────

export const webhookStatusMap: Record<string, StatusConfig> = {
  SUCCESS: { variant: 'success', appearance: 'light', label: 'สำเร็จ' },
  FAILED: { variant: 'destructive', appearance: 'light', label: 'ล้มเหลว' },
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอ' },
  RETRYING: { variant: 'info', appearance: 'light', label: 'ลองใหม่' },
};

// ─── Todo priorities ──────────────────────────────────────────────────────────

export const todoPriorityMap: Record<string, StatusConfig> = {
  URGENT: { variant: 'destructive', label: 'เร่งด่วน' },
  HIGH: { variant: 'warning', label: 'สูง' },
  MEDIUM: { variant: 'primary', appearance: 'light', label: 'ปานกลาง' },
  LOW: { variant: 'secondary', label: 'ต่ำ' },
};

// ─── Todo statuses ────────────────────────────────────────────────────────────

export const todoStatusMap: Record<string, StatusConfig> = {
  TODO: { variant: 'secondary', label: 'รอทำ' },
  IN_PROGRESS: { variant: 'primary', appearance: 'light', label: 'กำลังทำ' },
  DONE: { variant: 'success', appearance: 'light', label: 'เสร็จแล้ว' },
  CANCELLED: { variant: 'destructive', appearance: 'light', label: 'ยกเลิก' },
};

// ─── Asset statuses ───────────────────────────────────────────────────────────

export const assetStatusMap: Record<string, StatusConfig> = {
  ACTIVE: { variant: 'success', appearance: 'light', label: 'ใช้งาน' },
  MAINTENANCE: { variant: 'warning', appearance: 'light', label: 'ซ่อมบำรุง' },
  RETIRED: { variant: 'secondary', label: 'เลิกใช้' },
  DISPOSED: { variant: 'destructive', appearance: 'light', label: 'จำหน่ายแล้ว' },
};

// ─── Migration statuses ───────────────────────────────────────────────────────

export const migrationStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'secondary', label: 'รอ' },
  RUNNING: { variant: 'warning', appearance: 'light', label: 'กำลังทำ' },
  COMPLETED: { variant: 'success', appearance: 'light', label: 'เสร็จ' },
  FAILED: { variant: 'destructive', appearance: 'light', label: 'ล้มเหลว' },
  SKIPPED: { variant: 'info', appearance: 'light', label: 'ข้าม' },
};

// ─── System health statuses ───────────────────────────────────────────────────

export const systemHealthMap: Record<string, StatusConfig> = {
  healthy: { variant: 'success', appearance: 'light', label: 'ปกติ' },
  degraded: { variant: 'warning', appearance: 'light', label: 'มีปัญหาบางส่วน' },
  down: { variant: 'destructive', label: 'ล่ม' },
};

// ─── Chart of accounts group types ────────────────────────────────────────────

export const accountGroupMap: Record<string, StatusConfig> = {
  ASSET: { variant: 'primary', appearance: 'light', label: 'สินทรัพย์' },
  LIABILITY: { variant: 'warning', appearance: 'light', label: 'หนี้สิน' },
  EQUITY: { variant: 'info', appearance: 'light', label: 'ส่วนของเจ้าของ' },
  REVENUE: { variant: 'success', appearance: 'light', label: 'รายได้' },
  EXPENSE: { variant: 'destructive', appearance: 'light', label: 'ค่าใช้จ่าย' },
};

// ─── Dunning channel types ────────────────────────────────────────────────────

export const dunningChannelMap: Record<string, StatusConfig> = {
  LINE: { variant: 'success', appearance: 'light', label: 'LINE' },
  SMS: { variant: 'info', appearance: 'light', label: 'SMS' },
  CALL: { variant: 'warning', appearance: 'light', label: 'โทร' },
  CALL_TASK: { variant: 'warning', appearance: 'light', label: 'โทรติดตาม' },
  VISIT: { variant: 'primary', appearance: 'light', label: 'เยี่ยม' },
  INTERNAL_ALERT: { variant: 'secondary', label: 'แจ้งเตือนภายใน' },
  LEGAL: { variant: 'destructive', label: 'กฎหมาย' },
};

// ─── Sale types ───────────────────────────────────────────────────────────────

export const saleTypeMap: Record<string, StatusConfig> = {
  CASH: { variant: 'success', appearance: 'light', label: 'เงินสด' },
  INSTALLMENT: { variant: 'primary', appearance: 'light', label: 'ผ่อนชำระ' },
  GFIN: { variant: 'info', appearance: 'light', label: 'GFIN' },
  EXTERNAL_FINANCE: { variant: 'info', appearance: 'light', label: 'ไฟแนนซ์' },
};

// ─── Document statuses ────────────────────────────────────────────────────────

export const documentStatusMap: Record<string, StatusConfig> = {
  DRAFT: { variant: 'secondary', label: 'ร่าง' },
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอ' },
  SIGNED: { variant: 'success', appearance: 'light', label: 'เซ็นแล้ว' },
  EXPIRED: { variant: 'destructive', appearance: 'light', label: 'หมดอายุ' },
};

// ─── General helper ───────────────────────────────────────────────────────────

/**
 * Look up a status in a map.  Falls back to `{ variant: 'secondary', label: status }`
 * so unknown values still render safely.
 */
export function getStatusBadgeProps(
  status: string,
  map: Record<string, StatusConfig>,
): StatusConfig {
  return map[status] ?? { variant: 'secondary', label: status };
}
