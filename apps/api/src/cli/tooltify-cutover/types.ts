import type { DeviceOrigin, ProductStatus } from '@prisma/client';
import type { ParsedSale } from '../../modules/imported-sales/tooltify-sales-parser';
import type { StockProductCategory } from '../../modules/imported-sales/tooltify-stock-parser';

export type FileRef = {
  path: string;
  sha256: string;
  kind: 'STOCK_SNAPSHOT' | 'SALES' | 'ENRICHMENT';
  storeKey: string;
  branchId: string | null;
  reportFrom: string | null;
  reportTo: string | null;
};

export type SourceRef = { fileSha256: string; sheet: string; row: number; storeKey: string };
export type ImportIssue = { code: string; source: SourceRef | null; message: string };
export type Disposition = 'CREATE' | 'MATCH' | 'CONFLICT' | 'EXCLUDE';

export type InputManifest = {
  version: 1;
  cutoverAt: string;
  companyCode: 'SHOP';
  files: FileRef[];
  decisionsSha256: string;
  canonicalSetId: string;
  history?: { branchId: string; reportFrom: string; reportTo: string; evidenceRef: string }[];
};

export type ApplyReceipt = {
  batchId: string;
  created: number;
  matched: number;
  excluded: number;
  status: 'APPLIED' | 'FAILED';
};

export type SourceDecision = {
  fileSha256: string;
  sourceRows: number[];
  reason: string;
  evidenceRef: string;
} & (
  | { action: 'SELECT_SNAPSHOT'; branchId: string; storeKey: string; asOf: string }
  | {
      action: 'SELECT_SALES';
      branchId: string;
      storeKey: string;
      reportFrom: string;
      reportTo: string;
    }
  | { action: 'ZERO_SALES'; branchId: string; reportFrom: string; reportTo: string }
  | { action: 'REPORT_DUPLICATE'; keepRow: number }
  | { action: 'DISTINCT_UNITS' | 'EXCLUDE_FILE' | 'EXCLUDE_ROW' | 'UNRESOLVED' }
);

export type SourceDecisions = { entries: SourceDecision[] };

export type DateRange = { start: string; end: string };
export type SectionInspection = {
  label: string;
  headerRow: number;
  columns: string[];
  declaredRowCount: number | null;
  sourceRowCount: number;
};
export type FileInspection = {
  sha256: string;
  inputs: { alias: string; pathSha256: string }[];
  byteSize: number;
  kind: FileRef['kind'] | 'UNKNOWN';
  sheet: string;
  declaredRange: DateRange | null;
  actualRange: DateRange | null;
  sections: SectionInspection[];
  sourceRowCount: number;
  billCount: number | null;
  rows: { row: number; occurredAt: string | null }[];
  shopLabelMeaning: 'UNRESOLVED' | null;
  shopLabelGroups: { key: string; rowCount: number; missingLabel: boolean }[];
  issues: ImportIssue[];
};

export type InspectionReport = {
  version: 1;
  files: FileInspection[];
  duplicateRows: {
    kind: 'STOCK_IMEI' | 'SALE_LINE_KEY';
    identical: boolean;
    rows: SourceRef[];
    equalRowGroups: SourceRef[][];
  }[];
  salesOverlaps: {
    fileSha256s: [string, string];
    declaredRange: DateRange | null;
    actualRange: DateRange | null;
  }[];
  issues: ImportIssue[];
};

export type ParseResult<T> = { rows: T[]; issues: ImportIssue[] };

export type CanonicalStockUnit = {
  source: SourceRef;
  sourceKey: string;
  kind: 'DEVICE' | 'ACCESSORY';
  barcode: string;
  category: StockProductCategory;
  deviceOrigin: DeviceOrigin | null;
  name: string;
  brand: string;
  model: string;
  storage: string | null;
  color: string | null;
  cost: string;
  cashPrice: string | null;
  installmentPrice: string | null;
  financePrice: string | null;
  branchId: string;
  sourceStatus: string | null;
  desiredStatus: ProductStatus | null;
  importedAt: string;
  priceEvidence: string | null;
};

export type CanonicalSaleLine = Omit<ParsedSale, 'source' | 'importBatch'> & {
  source: SourceRef;
  sourceKey: string;
  sourceStoreKey: string;
  occurrence: number;
};

export type GrossSalesTotals = {
  bills: number;
  lines: number;
  costTotal: string;
  listPrice: string;
  salePrice: string;
  profit: string;
};

// null marks an individual count or amount that the source cannot establish.
export type NullableGrossSalesTotals = {
  [K in keyof GrossSalesTotals]: GrossSalesTotals[K] | null;
};

export type SalesReportResult = ParseResult<CanonicalSaleLine> & {
  gross: {
    reported: NullableGrossSalesTotals | null;
    detail: NullableGrossSalesTotals | null;
    // Reported minus raw detail, before source decisions.
    delta: NullableGrossSalesTotals | null;
  };
  adjustments: {
    label: string;
    source: SourceRef;
    declaredRows: number | null;
    detailRows: number[];
    reported: NullableGrossSalesTotals | null;
  }[];
};

export type CanonicalSalesResult = ParseResult<CanonicalSaleLine> & {
  excluded: {
    source: SourceRef;
    // Absent when the source cannot be linked to one particular canonical occurrence.
    sourceKey: string | null;
    reason: 'IDENTICAL_FILE_COPY' | 'REPORT_DUPLICATE' | 'EXCLUDE_FILE' | 'EXCLUDE_ROW';
  }[];
};
