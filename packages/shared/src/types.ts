import {
  UserRole,
  ContractStatus,
  ContractWorkflowStatus,
  ProductStatus,
  PaymentMethod,
  PlanType,
  ProductCategory,
  PaymentStatus,
  SaleType,
  POStatus,
  POPaymentStatus,
  ReceivingItemStatus,
  TransferStatus,
  InspectionScoreType,
  ConditionGrade,
  SignerType,
  NotificationChannel,
  RepossessionStatus,
  StockAdjustmentReason,
  CreditCheckStatus,
  ContractDocumentType,
} from './constants';

export type UserRoleType = (typeof UserRole)[keyof typeof UserRole];
export type ContractStatusType = (typeof ContractStatus)[keyof typeof ContractStatus];
export type ContractWorkflowStatusType = (typeof ContractWorkflowStatus)[keyof typeof ContractWorkflowStatus];
export type ProductStatusType = (typeof ProductStatus)[keyof typeof ProductStatus];
export type PaymentMethodType = (typeof PaymentMethod)[keyof typeof PaymentMethod];
export type PlanTypeType = (typeof PlanType)[keyof typeof PlanType];
export type ProductCategoryType = (typeof ProductCategory)[keyof typeof ProductCategory];
export type PaymentStatusType = (typeof PaymentStatus)[keyof typeof PaymentStatus];
export type SaleTypeType = (typeof SaleType)[keyof typeof SaleType];
export type POStatusType = (typeof POStatus)[keyof typeof POStatus];
export type POPaymentStatusType = (typeof POPaymentStatus)[keyof typeof POPaymentStatus];
export type ReceivingItemStatusType = (typeof ReceivingItemStatus)[keyof typeof ReceivingItemStatus];
export type TransferStatusType = (typeof TransferStatus)[keyof typeof TransferStatus];
export type InspectionScoreTypeType = (typeof InspectionScoreType)[keyof typeof InspectionScoreType];
export type ConditionGradeType = (typeof ConditionGrade)[keyof typeof ConditionGrade];
export type SignerTypeType = (typeof SignerType)[keyof typeof SignerType];
export type NotificationChannelType = (typeof NotificationChannel)[keyof typeof NotificationChannel];
export type RepossessionStatusType = (typeof RepossessionStatus)[keyof typeof RepossessionStatus];
export type StockAdjustmentReasonType = (typeof StockAdjustmentReason)[keyof typeof StockAdjustmentReason];
export type CreditCheckStatusType = (typeof CreditCheckStatus)[keyof typeof CreditCheckStatus];
export type ContractDocumentTypeType = (typeof ContractDocumentType)[keyof typeof ContractDocumentType];
