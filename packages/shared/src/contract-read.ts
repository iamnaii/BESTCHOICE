/** Ordinary managed FINANCE reads. Availability is authorization-derived, never a
 * comparison between hidden and visible row counts. Unavailable values are null. */
export type ContractReadAvailability = 'VISIBLE_CURRENT' | 'PARTIAL' | 'UNAVAILABLE';
export type ContractReadCategory =
  | 'customer'
  | 'product'
  | 'bundles'
  | 'payments'
  | 'documents'
  | 'credit'
  | 'collections'
  | 'mdm'
  | 'receipts'
  | 'chat'
  | 'journal';
export interface ContractReadMetadata {
  scope: 'authorized-sources';
  availability: Record<ContractReadCategory, ContractReadAvailability>;
}
