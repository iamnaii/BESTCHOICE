import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { parseSalesReport } from '../../modules/imported-sales/tooltify-sales-parser';
import { parseStockSnapshot } from '../../modules/imported-sales/tooltify-stock-snapshot-parser';
import {
  collectSections,
  publicWorksheetName,
} from '../../modules/imported-sales/tooltify-report-layout';
import { decodeXlsxWorksheet } from '../../modules/imported-sales/xlsx-reader';
import { canonicalizeSales, hashImportValue as hash, validateManifest } from './canonicalize';
import { inspectFiles } from './inspect';
import { aggregateSales, aggregateStock, stockMeasure } from './reconciliation-snapshot';
import type {
  CanonicalInput,
  CanonicalSaleLine,
  CanonicalStockUnit,
  ExcludedSource,
  InputManifest,
  NullableGrossSalesTotals,
  NullableStockTotals,
  SalesReportResult,
  SourceDecisions,
} from './types';

export async function loadManifest(path: string): Promise<InputManifest> {
  return JSON.parse(await readFile(path, 'utf8'));
}
function stockHeader(rows: string[][], basis: unknown): NullableStockTotals {
  const sections = collectSections(rows);
  const summaries = sections.filter((s) => s.label === 'สรุปสต๊อก');
  const unknown = { units: null, cost: null };
  if (summaries.length !== 1) return unknown;
  const section = summaries[0];
  const headings = rows[section.headerIndex].map((s) => s.trim());
  const required = [
    'ชื่อสินค้า',
    'หมวดหมู่สินค้า',
    'แหล่งที่มา',
    'รายละเอียดสินค้า',
    'จำนวน',
    'ต้นทุนสินค้า',
  ];
  if (required.some((h) => headings.filter((s) => s === h).length !== 1)) return unknown;
  const end = sections[sections.indexOf(section) + 1]?.startIndex ?? rows.length;
  let units = 0;
  let cost: Prisma.Decimal | null =
    basis === 'PER_UNIT' || basis === 'EXTENDED' ? new Prisma.Decimal(0) : null;
  const body = rows.slice(section.headerIndex + 1, end).filter((r) => r.some((s) => s.trim()));
  if (!body.length) return unknown;
  for (const r of body) {
    const qty = r[headings.indexOf('จำนวน')]?.trim(),
      value = r[headings.indexOf('ต้นทุนสินค้า')]?.trim();
    if (!/^\d+$/.test(qty)) return unknown;
    units += Number(qty);
    if (!Number.isSafeInteger(units)) return unknown;
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value)) cost = null;
    if (cost)
      cost = cost.plus(
        new Prisma.Decimal(value.replaceAll(',', '')).times(basis === 'PER_UNIT' ? qty : 1),
      );
  }
  return { units, cost: cost?.toFixed(2) ?? null };
}
function sumSales(values: (NullableGrossSalesTotals | null)[]): NullableGrossSalesTotals {
  const result: NullableGrossSalesTotals = {
    bills: 0,
    lines: 0,
    costTotal: '0.00',
    listPrice: '0.00',
    salePrice: '0.00',
    profit: '0.00',
  };
  for (const row of values) {
    for (const k of ['lines', 'bills'] as const)
      result[k] = row?.[k] == null || result[k] === null ? null : result[k] + row[k];
    for (const k of ['costTotal', 'listPrice', 'salePrice', 'profit'] as const)
      result[k] =
        row?.[k] == null || result[k] === null
          ? null
          : new Prisma.Decimal(result[k]).plus(row[k]).toFixed(2);
  }
  return result;
}
export async function loadSourceInputs(
  path: string,
  decisionsPath: string | undefined,
  codeRevision: string,
  expectedDbIdentity: string,
): Promise<CanonicalInput[]> {
  const manifest = await loadManifest(path);
  const decisions: SourceDecisions = JSON.parse(
    await readFile(decisionsPath ?? join(dirname(path), 'source-decisions.json'), 'utf8'),
  );
  const inspection = await inspectFiles(
    [...manifest.files, ...(manifest.copies ?? [])].map((f) => f.path),
  );
  const countPhysical = (kind: 'SALES' | 'STOCK_SNAPSHOT') =>
    inspection.files
      .filter(
        (f) =>
          f.kind === kind &&
          manifest.files.some((ref) => ref.sha256 === f.sha256 && ref.kind === kind),
      )
      .reduce((sum, f) => sum + f.rows.length, 0);
  const issues = validateManifest(manifest, inspection, decisions);
  const seenIssues = new Set(issues);
  for (const f of inspection.files)
    for (const issue of f.issues) if (!seenIssues.has(issue)) issues.push(issue);
  const excludedUnitRefs = new Set<string>();
  const sales: CanonicalSaleLine[] = [],
    stock: CanonicalStockUnit[] = [],
    excludedStock: CanonicalStockUnit[] = [],
    stockExclusions: ExcludedSource[] = [];
  const summaries: SalesReportResult['gross'][] = [];
  const stockHeaders: NullableStockTotals[] = [];
  for (const file of manifest.files) {
    const evidence = inspection.files.find((f) => f.sha256 === file.sha256);
    if (!evidence || evidence.kind !== file.kind) {
      issues.push({
        code: 'FILE_HASH_OR_KIND_MISMATCH',
        source: null,
        message: 'FILE_HASH_OR_KIND_MISMATCH',
      });
      continue;
    }
    // The path spelling used by validateManifest is retained. Decode only the buffer whose
    // checksum matches the reviewed bytes, even if the path changed between reads.
    const bytes = await readFile(file.path);
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
      throw Error('FILE_HASH_MISMATCH');
    if (file.kind === 'ENRICHMENT') {
      if (
        !decisions.entries.some((d) => d.fileSha256 === file.sha256 && d.action === 'EXCLUDE_FILE')
      )
        issues.push({
          code: 'UNRESOLVED_ENRICHMENT',
          source: null,
          message: 'UNRESOLVED_ENRICHMENT',
        });
      continue;
    }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.read(Readable.from([bytes]));
    if (wb.worksheets.length !== 1) throw Error('AMBIGUOUS_WORKSHEET');
    const ws = wb.worksheets[0],
      sheet = publicWorksheetName(ws.name),
      table = decodeXlsxWorksheet(ws);
    const context = { sheet, file, canonicalSetId: manifest.canonicalSetId };
    const physical = new Set(evidence.rows.map((r) => r.row));
    if (file.kind === 'SALES') {
      const parsed = parseSalesReport(table, context);
      issues.push(...parsed.issues);
      sales.push(...parsed.rows);
      summaries.push(parsed.gross);
      for (const row of parsed.rows) physical.delete(row.source.row);
    } else {
      const parsed = parseStockSnapshot(table, context);
      issues.push(...parsed.issues);
      const entries = decisions.entries.filter((d) => d.fileSha256 === file.sha256);
      const selection = entries.find(
        (d) => d.action === 'SELECT_SNAPSHOT' || d.action === 'EXCLUDE_FILE',
      );
      stockHeaders.push(
        stockHeader(
          table,
          selection && 'summaryCostBasis' in selection ? selection.summaryCostBasis : null,
        ),
      );
      for (const row of parsed.rows) {
        physical.delete(row.source.row);
        const exclusion = entries.find(
          (d) =>
            (d.action === 'EXCLUDE_FILE' || d.action === 'EXCLUDE_ROW') &&
            d.sourceRows.includes(row.source.row),
        );
        if (exclusion?.action === 'EXCLUDE_FILE' || exclusion?.action === 'EXCLUDE_ROW') {
          if (exclusion.reportedUnitsPerRow === 1) excludedUnitRefs.add(hash(row.source));
          stockExclusions.push({ source: row.source, sourceKey: null, reason: exclusion.action });
          excludedStock.push(row);
        } else stock.push(row);
      }
    }
    for (const row of physical)
      issues.push({
        code: 'UNACCOUNTED_PHYSICAL_ROW',
        source: { fileSha256: file.sha256, sheet, storeKey: file.storeKey, row },
        message: 'UNACCOUNTED_PHYSICAL_ROW',
      });
  }
  const canonical = canonicalizeSales(sales, decisions);
  issues.push(...canonical.issues);
  const common = { manifest, decisions, codeRevision, expectedDbIdentity, issues };
  const inputs: CanonicalInput[] = [];
  const saleFiles = manifest.files.filter((f) => f.kind === 'SALES');
  if (saleFiles.length) {
    const branches = new Map(saleFiles.map((f) => [f.sha256, f.branchId ?? '']));
    const raw = aggregateSales(
      sales.map((r) => ({ ...r, branchId: branches.get(r.source.fileSha256) ?? '' })),
    );
    const detail = sumSales(summaries.map((s) => s.detail)),
      reported = sumSales(summaries.map((s) => s.reported)),
      delta = sumSales(summaries.map((s) => s.delta));
    // Report headers give per-file bill counts. Verified file-level distinct counts can be
    // combined only with their physical bill identities, since bills can appear in two reports.
    if (summaries.every((s) => s.detail?.bills != null) && sales.length === detail.lines)
      detail.bills = raw.totals.bills;
    else detail.bills = null;
    if (detail.bills !== null && summaries.every((s) => s.delta?.bills === 0)) {
      reported.bills = detail.bills;
      delta.bills = 0;
    } else if (summaries.length > 1) {
      reported.bills = null;
      delta.bills = null;
    }
    const refs = new Set(
      canonical.excluded
        .filter((e) => e.reason !== 'IDENTICAL_FILE_COPY')
        .map((e) => hash(e.source)),
    );
    inputs.push({
      ...common,
      kind: 'SALES',
      uniquePhysicalRows: countPhysical('SALES'),
      rows: canonical.rows,
      excluded: canonical.excluded,
      excludedEvidence: sales.filter((r) => refs.has(hash(r.source))),
      sourceSummary: {
        kind: 'SALES',
        detail,
        reported,
        delta,
        groups: raw.groups,
        evidenceFileSha256s: saleFiles.map((f) => f.sha256),
      },
    });
  }
  const stockFiles = manifest.files.filter((f) => f.kind === 'STOCK_SNAPSHOT');
  if (stockFiles.length) {
    const raw = aggregateStock([...stock, ...excludedStock].map(stockMeasure));
    const parsedAll =
      raw.totals.units === countPhysical('STOCK_SNAPSHOT') &&
      stockHeaders.length === stockFiles.length;
    const mappedAccessories = new Map<string, Set<number>>();
    for (const d of decisions.entries) {
      if (
        d.action === 'MAP_ACCESSORY_UNITS' &&
        d.checkedQuantity === d.sourceRows.length &&
        d.checkedQuantity === d.assignments.length
      ) {
        mappedAccessories.set(
          hash([d.fileSha256, d.sku]),
          new Set(d.assignments.map((a) => a.row)),
        );
      }
    }
    const verifiedUnits =
      parsedAll &&
      excludedStock.every((r) => r.kind !== 'ACCESSORY' || excludedUnitRefs.has(hash(r.source))) &&
      stock.every(
        (r) =>
          r.kind !== 'ACCESSORY' ||
          mappedAccessories.get(hash([r.source.fileSha256, r.barcode]))?.has(r.source.row),
      );
    const detail: NullableStockTotals = {
      units: verifiedUnits ? raw.totals.units : null,
      cost: parsedAll ? raw.totals.cost : null,
    };
    const reported: NullableStockTotals = { units: 0, cost: '0.00' };
    for (const h of stockHeaders) {
      reported.units =
        h.units === null || reported.units === null ? null : reported.units + h.units;
      reported.cost =
        h.cost === null || reported.cost === null
          ? null
          : new Prisma.Decimal(reported.cost).plus(h.cost).toFixed(2);
    }
    inputs.push({
      ...common,
      kind: 'STOCK',
      uniquePhysicalRows: countPhysical('STOCK_SNAPSHOT'),
      rows: stock,
      excluded: stockExclusions,
      excludedEvidence: excludedStock,
      sourceSummary: {
        kind: 'STOCK',
        reported,
        detail,
        delta: {
          units:
            reported.units === null || detail.units === null ? null : reported.units - detail.units,
          cost:
            reported.cost === null || detail.cost === null
              ? null
              : new Prisma.Decimal(reported.cost).minus(detail.cost).toFixed(2),
        },
        groups: verifiedUnits ? raw.groups : null,
        evidenceFileSha256s: stockFiles.map((f) => f.sha256),
      },
    });
  }
  for (const input of inputs) {
    const primaries = [...input.rows, ...input.excluded];
    for (const copy of manifest.copies ?? []) {
      for (const { source, sourceKey } of primaries.filter(
        (r) => r.source.fileSha256 === copy.sha256,
      )) {
        input.excluded.push({ source, sourceKey, reason: 'IDENTICAL_FILE_COPY' });
      }
    }
  }
  return inputs;
}
