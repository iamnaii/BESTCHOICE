export type SupplierInput = {
  supplierRef: string;
  displayName: string;
  aliases: string[];
  legalName: string | null;
  type: 'INDIVIDUAL' | 'JURISTIC' | null;
  phone: string | null;
  lineId: string | null;
  contactName: string | null;
  address: string | null;
  postalCode: string | null;
  taxId: string | null;
  branchCode: string | null;
  hasVat: boolean | null;
  creditTermDays: number | null;
  bankAccounts: {
    bankName: string | null;
    bankAccountName: string | null;
    bankAccountNumber: string | null;
  }[];
  legalProfileScope: 'GROUP' | 'CHANNEL_ONLY' | 'OWNER_ADOPTED_GROUP';
  notes: string | null;
  purchaseVatTerms: string | null;
  evidenceRefs: { workbookSha256: string; sheet: string; row: number }[];
};
export type SupplierIssue = {
  supplierRef: string;
  code: string;
  field: string;
  evidenceRef: SupplierInput['evidenceRefs'][number] | null;
};
export type SupplierValidation = { rows: SupplierInput[]; issues: SupplierIssue[] };
