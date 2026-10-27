/** Managed basic Customer query metadata. Values/counts describe authorized data,
 * never a claim that inaccessible history is empty. Legacy response shapes remain separate. */
export type PartyContributorCoverage = 'scoped' | 'unavailable';
export type PartyCreditCoverage = 'complete' | 'partial' | 'unavailable';
export type CustomerViewCoverage = 'scoped' | 'partial' | 'unavailable';
export interface CustomerQueryAvailability {
  credit: PartyCreditCoverage;
  acquisition: 'available' | 'unavailable';
  documents: 'available' | 'unavailable';
  contracts: PartyContributorCoverage;
  warrantyContracts: PartyContributorCoverage;
  sales: PartyContributorCoverage;
  chat: PartyContributorCoverage;
  manualTags: 'available' | 'unavailable';
  autoTags: 'available' | 'unavailable';
}
export interface CustomerQueryViewMetadata {
  /** List membership is evaluated within visible contributors, including prospects. */
  viewCoverage: CustomerViewCoverage;
  viewCounts: { customers: number | null; prospects: number | null };
}

/** SHOP warranty metadata only. This reference does not authorize FINANCE detail navigation. */
export interface CustomerWarrantyContractView {
  id: string;
  contractNumber: string;
  status: string;
  createdAt: string;
  deviceReceivedAt: string | null;
  shopWarrantyEndDate: string | null;
  branch: { id: string; name: string } | null;
}

/** Managed KPI values are nullable; zero is a verified scoped zero. */
export type ManagedCustomerQueryKpis =
  | {
      total: number;
      installment: number | null;
      cash: number | null;
      externalFinance: number | null;
      overdue: number | null;
      fromChat: number | null;
    }
  | {
      total: number;
      contacted7d: number | null;
      checkingCredit: number | null;
      prechecked: number | null;
      silent30d: number | null;
    };

export interface ManagedCustomerPurchaseCounts {
  installmentTotal: number | null;
  installmentByState: Record<string, number> | null;
  cashCount: number | null;
  externalFinanceCount: number | null;
}
export interface ManagedCustomerContractProgressAvailability {
  payments: boolean;
  mdm: boolean;
  collections: boolean;
  product: boolean;
}

/** Runtime projection can make source-derived fields unavailable. Preserve the
 * unmanaged legacy response separately; consumers of managed reads must narrow. */
type NullableCustomerField =
  | 'documents'
  | 'contactId'
  | 'acquisitionSource'
  | 'acquisitionSourceRaw'
  | 'source'
  | 'chatPlaceholder'
  | 'activeContracts'
  | 'overdueContracts'
  | 'activeContractCount'
  | 'creditCheckStatus'
  | 'latestCreditStatus'
  | 'latestCreditScore'
  | 'tags';
export type ManagedCustomerProjection<T> = {
  [K in keyof T as K extends `${string}Encrypted` | `${string}Hash`
    ? never
    : K]: K extends NullableCustomerField
    ? T[K] | null
    : K extends '_count'
      ? Omit<T[K], 'contracts'> & { contracts: number | null }
      : K extends 'purchase'
        ?
            | (Omit<NonNullable<T[K]>, keyof ManagedCustomerPurchaseCounts> &
                ManagedCustomerPurchaseCounts)
            | null
        : T[K];
} & { availability: CustomerQueryAvailability };
