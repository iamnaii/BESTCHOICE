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
  // Evidence confirms both desiredStatus and that source importedAt is the unit's stockInDate.
  | {
      action: 'RESOLVE_STOCK';
      desiredStatus: 'IN_STOCK' | 'QC_PENDING';
      deviceOrigin: DeviceOrigin | null;
      pricing: StockPricingDecision;
    }
  | {
      action: 'MAP_ACCESSORY_UNITS';
      sku: string;
      checkedQuantity: number;
      assignments: { row: number; targetId: string | null }[];
    }
  | { action: 'REPORT_DUPLICATE'; keepRow: number }
  | { action: 'DISTINCT_UNITS' | 'EXCLUDE_FILE' | 'EXCLUDE_ROW' | 'UNRESOLVED' }
);

export type StockPriceColumns = Pick<
  CanonicalStockUnit,
  'cashPrice' | 'installmentPrice' | 'financePrice'
>;
export type StockPricingDecision =
  | ({ mode: 'EXPLICIT' } & StockPriceColumns)
  | { mode: 'TEMPLATE' };
export type SourceDecisions = { entries: SourceDecision[] };

export type ExcludedSource = CanonicalSalesResult['excluded'][number];
export type StockTotals = { units: number; cost: string };
export type NullableStockTotals = { units: number | null; cost: string | null };
export type SalesGroup<T> = { month: string; channel: string; branchId: string; totals: T };
export type StockGroup<T> = {
  branchId: string;
  kind: 'DEVICE' | 'ACCESSORY';
  skuHash: string | null;
  totals: T;
};
type SourceSummary<T, G> = {
  reported: T | null;
  detail: T | null;
  delta: T | null;
  groups: G[] | null;
  evidenceFileSha256s: string[];
};
export type SalesSourceSummary = { kind: 'SALES' } & SourceSummary<
  NullableGrossSalesTotals,
  SalesGroup<NullableGrossSalesTotals>
>;
export type StockSourceSummary = { kind: 'STOCK' } & SourceSummary<
  NullableStockTotals,
  StockGroup<NullableStockTotals>
>;
export type ReconciliationSnapshot = {
  version: 1;
  cannotVerifySource: boolean;
  files: { fileSha256: string; branchId: string | null }[];
  source: SalesSourceSummary | StockSourceSummary | null;
  exclusions: { reason: ExcludedSource['reason']; lines: number }[];
  canonical:
    | { kind: 'SALES'; totals: GrossSalesTotals; groups: SalesGroup<GrossSalesTotals>[] }
    | { kind: 'STOCK'; totals: StockTotals; groups: StockGroup<StockTotals>[] };
};
export type CanonicalInput = {
  manifest: InputManifest;
  decisions: SourceDecisions;
  codeRevision: string;
  expectedDbIdentity: string;
  /** Aggregate inspection, validateManifest and parser/canonicalizer issues before planning. */
  issues: ImportIssue[];
  excluded: ExcludedSource[];
} & (
  | { kind: 'STOCK'; rows: CanonicalStockUnit[]; sourceSummary?: StockSourceSummary }
  | { kind: 'SALES'; rows: CanonicalSaleLine[]; sourceSummary?: SalesSourceSummary }
);

export type StockResolution = StockPriceColumns & {
  companyId: string | null;
  templateId: string | null;
};
type PlanItemBase = {
  batchId: string;
  sourceKey: string;
  payloadHash: string;
  disposition: Disposition;
  targetId: string | null;
  reason: string | null;
  dependencyFingerprint: string;
  branchId: string;
};
export type PlannedStockItem = PlanItemBase & {
  kind: 'STOCK';
  original: CanonicalStockUnit;
  payload: CanonicalStockUnit;
  resolution: StockResolution;
  decision: Extract<SourceDecision, { action: 'RESOLVE_STOCK' }> | null;
  accessoryMapping: Extract<SourceDecision, { action: 'MAP_ACCESSORY_UNITS' }> | null;
};
export type PlannedSalesItem = PlanItemBase & { kind: 'SALES'; payload: CanonicalSaleLine };
export type PlannedItem = PlannedStockItem | PlannedSalesItem;
export type TargetWriteResult = {
  targetType: 'PRODUCT' | 'IMPORTED_SALE';
  targetId: string;
  created: boolean;
  afterFingerprint: string;
};
export type PlannedExclusion = ExcludedSource & { receiptKey: string; payloadHash: string };
export type ImportPlan = {
  batchId: string;
  canonicalSetId: string;
  kind: 'STOCK' | 'SALES';
  sourceCutoverAt: string;
  codeRevision: string;
  dbIdentity: string;
  manifestHash: string;
  decisionsHash: string;
  planHash: string;
  dependencyFingerprint: string;
  items: PlannedItem[];
  excluded: PlannedExclusion[];
  reconciliationSnapshot: ReconciliationSnapshot;
  totals: {
    created: number;
    matched: number;
    conflicts: number;
    excluded: number;
    stockCost: string;
    sales: GrossSalesTotals | null;
  };
  issues: ImportIssue[];
};

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
