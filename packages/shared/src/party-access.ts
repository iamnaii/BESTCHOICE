import type { Company } from './company-access';
/** Persisted immutable provenance. Null means unknown historical provenance. */
export interface PartyAccessIdentity {
  readonly accessCompanyCode: Company | null;
  readonly accessBranchId: string | null;
  /** Current business assignee, never an employee permission grant. */
  assignedToId: string | null;
}
export interface PartyOrigin {
  readonly accessCompanyCode: Company;
  readonly accessBranchId: string | null;
}
export interface CustomerActionAcknowledgement {
  id: string;
}
export interface ContactRoleActionAcknowledgement {
  contactId: string;
  role: 'CUSTOMER' | 'SUPPLIER' | 'TRADE_IN_SELLER';
  customerId?: string;
  supplierId?: string;
  provisioned: boolean;
}
/** Company remains the authenticated work selector, never a body-owned origin. */
export interface PartyDestination {
  branchId?: string | null;
  assignedToId?: string | null;
}
export interface ContactRoleDestination extends PartyDestination {
  /** Only a genuinely new Customer child; matching existing value is a verified retry. */
  customerAssignedToId?: string | null;
}

/** Field names only: contact acknowledgements never return PII or duplicate identities. */
export type CustomerContactChangedField =
  | 'phone'
  | 'nationalId'
  | 'name'
  | 'prefix'
  | 'nickname'
  | 'facebookName'
  | 'phoneSecondary'
  | 'lineIdFinance'
  | 'status';
export interface CustomerFillContactAcknowledgement extends CustomerActionAcknowledgement {
  changedFields: CustomerContactChangedField[];
}
export interface CustomerUpdateContactAcknowledgement extends CustomerFillContactAcknowledgement {
  /** null also covers same-primary repair; changedFields still reports that write. */
  phoneStoredAs: 'PRIMARY' | 'SECONDARY' | null;
}

/** Managed merges acknowledge identities only; refresh separately authorized reads. */
export interface CustomerAbsorbAcknowledgement {
  placeholderId: string;
  targetId: string;
}
export interface ContactMergeAcknowledgement {
  primaryId: string;
  duplicateId: string;
}
