export type SalesReadActor = { id: string; role: string; branchId?: string | null };

export interface SalesReadFilters {
  saleType?: string;
  branchId?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  paymentMethod?: string;
  salespersonId?: string;
  contractStatus?: string;
  includeVoided?: boolean;
  page?: number;
  limit?: number;
}
