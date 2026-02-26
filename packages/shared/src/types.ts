import {
  UserRole,
  ContractStatus,
  ProductStatus,
  PaymentMethod,
  PlanType,
  ProductCategory,
} from './constants';

export type UserRoleType = (typeof UserRole)[keyof typeof UserRole];
export type ContractStatusType = (typeof ContractStatus)[keyof typeof ContractStatus];
export type ProductStatusType = (typeof ProductStatus)[keyof typeof ProductStatus];
export type PaymentMethodType = (typeof PaymentMethod)[keyof typeof PaymentMethod];
export type PlanTypeType = (typeof PlanType)[keyof typeof PlanType];
export type ProductCategoryType = (typeof ProductCategory)[keyof typeof ProductCategory];
