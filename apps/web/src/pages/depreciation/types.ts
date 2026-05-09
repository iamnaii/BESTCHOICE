// Depreciation module — type definitions (Phase 2)
// Mirrors backend DTOs in apps/api/src/modules/depreciation/dto/.

export interface DepreciationRunSummary {
  period: string;
  entryNumbers: string[];
  totalAmount: string;
  assetCount: number;
  ranAt: string;
  runByName: string | null;
  status: 'POSTED' | 'REVERSED';
}

export interface DepreciationPreviewLine {
  assetId: string;
  assetCode: string;
  assetName: string;
  monthlyDepr: string;
  drAccount: string;
  crAccount: string;
}

export interface DepreciationPreview {
  period: string;
  lines: DepreciationPreviewLine[];
  totalAmount: string;
  assetCount: number;
  alreadyRunForAssetIds: string[];
}
