import { open, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { constants } from 'node:fs';
import { parseArgs } from 'node:util';
import { inspectFiles, inputPathSha256 } from './tooltify-cutover/inspect';
import { bindWriterRevision, readCheckoutRevision } from './tooltify-cutover/checkout-revision';
import { PrismaClient } from '@prisma/client';
import { applyRollback, planRollback, parseReviewedRollback } from './tooltify-cutover/rollback';
import { applyBatch } from './tooltify-cutover/batch';
import { buildImportPlan, readImportDatabaseIdentity } from './tooltify-cutover/plan';
import {
  reconcileBatch,
  hasVerifiedSource,
  verifyAppliedBatch,
} from './tooltify-cutover/reconcile';
import { loadManifest, loadSourceInputs } from './tooltify-cutover/source-input';
import { hashImportValue } from './tooltify-cutover/canonicalize';
import { writeStockItem } from './tooltify-cutover/stock-writer';
import { writeSalesItem } from './tooltify-cutover/sales-writer';
import type {
  ApplyReceipt,
  ImportPlan,
  ReconciliationReport,
  RollbackPlan,
  RollbackReceipt,
  InspectionReport,
} from './tooltify-cutover/types';

const USAGE =
  'npm run import:tooltify-cutover --workspace=@installment/api -- inspect --out-dir <dir> <file.xlsx> [<file.xlsx> ...]';

function csvField(value: string | number | null | undefined): string {
  const text = String(value ?? '');
  const escaped = /^[\s]*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + escaped.replace(/"/g, '""') + '"';
}

function inspectionCsv(report: InspectionReport): string {
  const rows: (string | number | null | undefined)[][] = [
    [
      'sha256',
      'input_aliases',
      'bytes',
      'kind',
      'declared_from',
      'declared_to',
      'actual_from_bangkok',
      'actual_to_bangkok',
      'file_detail_rows',
      'bill_count',
      'section',
      'header_row',
      'columns',
      'section_declared_rows',
      'section_observed_rows',
    ],
  ];
  for (const file of report.files) {
    const summary = [
      file.sha256,
      file.inputs.map(({ alias }) => alias).join(' | '),
      file.byteSize,
      file.kind,
      file.declaredRange?.start,
      file.declaredRange?.end,
      file.actualRange?.start,
      file.actualRange?.end,
      file.sourceRowCount,
      file.billCount,
    ];
    if (!file.sections.length) rows.push(summary);
    for (const section of file.sections) {
      rows.push([
        ...summary,
        section.label,
        section.headerRow,
        section.columns.join(' | '),
        section.declaredRowCount,
        section.sourceRowCount,
      ]);
    }
  }
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

async function privateOutput(outDir: string, reports: { name: string; content: string }[]) {
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  if (((await stat(outDir)).mode & 0o077) !== 0) throw Error('PRIVATE_OUTPUT_DIRECTORY_REQUIRED');
  const stage = await mkdtemp(join(outDir, '.tooltify-inspection-'));
  try {
    await Promise.all(
      reports.map(({ name, content }) => writeFile(join(stage, name), content, { mode: 0o600 })),
    );
    for (const { name } of reports) await rename(join(stage, name), join(outDir, name));
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
async function inspect(paths: string[], outDir: string, path?: string): Promise<number> {
  const manifest = path ? await loadManifest(path) : null;
  const sources = manifest ? [...manifest.files, ...(manifest.copies ?? [])] : null;
  const report = await inspectFiles(sources ? sources.map((s) => s.path) : paths);
  if (
    sources?.some(
      (s) =>
        !report.files.some(
          (f) =>
            f.sha256 === s.sha256 && f.inputs.some((i) => i.pathSha256 === inputPathSha256(s.path)),
        ),
    )
  )
    report.issues.push({ code: 'FILE_HASH_MISMATCH', source: null, message: 'FILE_HASH_MISMATCH' });
  const reports = [
    { name: 'inspection.json', content: JSON.stringify(report, null, 2) + '\n' },
    { name: 'inspection.csv', content: inspectionCsv(report) },
  ];
  await privateOutput(outDir, reports);
  console.log(
    `ตรวจ ${report.files.length} ไฟล์ที่ checksum ต่างกัน เขียน inspection.json และ inspection.csv แล้ว`,
  );
  if (
    report.issues.length ||
    report.files.some(
      ({ kind, issues }) => kind === 'UNKNOWN' || issues.some(({ source }) => source === null),
    )
  ) {
    return 1;
  }
  return 0;
}
type SourceKind = 'STOCK' | 'SALES';
type Identity = Awaited<ReturnType<typeof readImportDatabaseIdentity>>;
export type CliDependencies = {
  env: NodeJS.ProcessEnv;
  identity(): Promise<Identity>;
  verifySocket(id: Identity): Promise<boolean>;
  prepare(
    manifest: string,
    decisions: string | undefined,
    kind: SourceKind | undefined,
    identity: string,
    write: boolean,
  ): Promise<ImportPlan>;
  apply(plan: ImportPlan): Promise<ApplyReceipt>;
  verify(batchId: string, planHash: string): Promise<ReconciliationReport>;
  reconcile(batchId: string, manifest: string): Promise<ReconciliationReport>;
  rollbackPlan(id: string, manifest: string, write: boolean): Promise<RollbackPlan>;
  readReviewedRollback(dir: string): Promise<RollbackPlan>;
  rollback(plan: RollbackPlan, waiting: (state: unknown) => void): Promise<RollbackReceipt>;
  inspect(paths: string[], outDir: string, manifest?: string): Promise<number>;
  report(value: unknown): void;
  save?(dir: string, name: string, value: unknown): Promise<void>;
};
const confirmation = 'YES_I_AM_SURE';
async function checkIdentity(
  id: Identity,
  env: NodeJS.ProcessEnv,
  write: boolean,
  verifySocket: (id: Identity) => Promise<boolean>,
) {
  if ((write || env.EXPECTED_DB_NAME) && id.database !== env.EXPECTED_DB_NAME)
    throw Error('EXPECTED_DB_NAME_MISMATCH');
  if ((write || env.EXPECTED_DB_FINGERPRINT) && id.fingerprint !== env.EXPECTED_DB_FINGERPRINT)
    throw Error('EXPECTED_DB_FINGERPRINT_MISMATCH');
  // The isolated harness has no TCP listener. A TCP loopback address can route through
  // a proxy to production, and NODE_ENV cannot attest the connected database.
  if (!write) return;
  const isolated =
    id.database === 'bc_vitest_test' &&
    id.schema === 'public' &&
    /^\/(?:private\/)?tmp\/bc-vitest-db\.[A-Za-z0-9]+\/socket$/.test(id.host) &&
    (await verifySocket(id));
  if (!isolated && env.ALLOW_PROD_TOOLTIFY_IMPORT !== confirmation)
    throw Error('ALLOW_PROD_TOOLTIFY_IMPORT_REQUIRED');
}
function planReport(p: ImportPlan, privateReview = false) {
  const ref = (r: ImportPlan['items'][number]['payload']['source']) => ({
    fileSha256: r.fileSha256,
    sheet: r.sheet,
    row: r.row,
  });
  return {
    kind: p.kind,
    planHash: p.planHash,
    manifestHash: p.manifestHash,
    decisionsHash: p.decisionsHash,
    codeRevision: p.codeRevision,
    dbFingerprint: p.dbIdentity,
    totals: p.totals,
    source: p.reconciliationSnapshot.source,
    canonical: p.reconciliationSnapshot.canonical,
    adjustments: p.reconciliationSnapshot.adjustments,
    uniquePhysicalRows: p.reconciliationSnapshot.uniquePhysicalRows,
    sourceVerified: hasVerifiedSource(p.reconciliationSnapshot),
    issues: p.issues.map((i) => ({
      kind: i.kind ?? p.kind,
      code: i.code,
      source: i.source ? ref(i.source) : null,
      ...(i.stockDelta
        ? { stockDelta: { units: i.stockDelta.units, cost: i.stockDelta.cost } }
        : {}),
    })),
    items: p.items.map((i) => ({
      source: ref(i.payload.source),
      sourceKey: i.sourceKey,
      disposition: i.disposition,
      targetId: i.targetId,
      reason: i.reason,
      ...(i.kind === 'STOCK' ? { stockInDate: i.original.importedAt } : {}),
      ...(privateReview && i.kind === 'STOCK'
        ? {
            branchId: i.branchId,
            kind: i.original.kind,
            status: i.payload.desiredStatus,
            cost: i.payload.cost,
            pricingMode: i.decision?.pricing.mode ?? null,
            templateId: i.resolution.templateId,
            cashPrice: i.resolution.cashPrice,
            installmentPrice: i.resolution.installmentPrice,
            financePrice: i.resolution.financePrice,
          }
        : {}),
    })),
    excluded: p.excluded.map((e) => ({
      source: ref(e.source),
      reason: e.reason,
      canonicalSourceKey: e.sourceKey,
    })),
  };
}
export async function runCutover(args: string[], deps: CliDependencies): Promise<number> {
  try {
    const { positionals, values: v } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        manifest: { type: 'string' },
        decisions: { type: 'string' },
        'source-kind': { type: 'string' },
        'batch-id': { type: 'string' },
        'out-dir': { type: 'string' },
        'plan-hash': { type: 'string' },
        apply: { type: 'boolean' },
        help: { type: 'boolean' },
      },
    });
    const output = async (name: string, value: unknown, summary: unknown = value) => {
      if (v['out-dir']) {
        if (!deps.save) throw Error('PRIVATE_REPORT_WRITER_REQUIRED');
        await deps.save(v['out-dir'], name, value);
      }
      deps.report(summary);
    };
    if (v.help) {
      deps.report({
        usage: [
          USAGE,
          '[dry-run|apply] --manifest FILE [--decisions FILE] [--source-kind sales|current-stock-snapshot]',
          'apply also requires --apply --plan-hash HASH, CONFIRM_TOOLTIFY_IMPORT, EXPECTED_DB_NAME and EXPECTED_DB_FINGERPRINT',
          'reconcile --manifest FILE --batch-id UUID',
          'rollback-dry-run --manifest FILE --batch-id UUID --out-dir PRIVATE_DIR',
          'rollback --manifest FILE --batch-id UUID --out-dir PRIVATE_DIR --apply --plan-hash ROLLBACK_HASH (requires import write confirmations and an offline PostgreSQL maintenance window)',
        ],
      });
      return 0;
    }
    const [mode = 'dry-run', ...paths] = positionals;
    if (mode === 'inspect') {
      if (
        v.apply ||
        !v['out-dir'] ||
        (!paths.length && !v.manifest) ||
        (paths.length && v.manifest)
      )
        throw Error('INSPECT_INPUT_AND_OUT_DIR_REQUIRED');
      return deps.inspect(paths, v['out-dir'], v.manifest);
    }
    if (!v.manifest || paths.length) throw Error('MANIFEST_REQUIRED');
    if (!['dry-run', 'apply', 'reconcile', 'rollback', 'rollback-dry-run'].includes(mode))
      throw Error('UNKNOWN_CUTOVER_MODE');
    const write = mode === 'apply' || mode === 'rollback';
    if (
      write &&
      (!v.apply ||
        !v['plan-hash'] ||
        deps.env.CONFIRM_TOOLTIFY_IMPORT !== confirmation ||
        !deps.env.EXPECTED_DB_NAME ||
        !deps.env.EXPECTED_DB_FINGERPRINT)
    )
      throw Error('APPLY_CONFIRMATIONS_REQUIRED');
    if (!write && (v.apply || v['plan-hash'])) throw Error('UNEXPECTED_WRITE_FLAG');
    let kind: SourceKind | undefined;
    if (v['source-kind'] === 'sales') kind = 'SALES';
    else if (v['source-kind'] === 'current-stock-snapshot') kind = 'STOCK';
    else if (v['source-kind']) throw Error('UNKNOWN_SOURCE_KIND');
    const reverse = mode === 'rollback' || mode === 'rollback-dry-run';
    if (reverse && (!v['batch-id'] || !v['out-dir'] || v.decisions))
      throw Error('ROLLBACK_BATCH_AND_PRIVATE_OUT_DIR_REQUIRED');
    const id = await deps.identity();
    await checkIdentity(id, deps.env, write, deps.verifySocket);
    if (reverse) {
      const plan = await deps.rollbackPlan(v['batch-id']!, v.manifest, write);
      if (kind && plan.kind !== kind) throw Error('BATCH_KIND_MISMATCH');
      if (plan.dbIdentity !== id.fingerprint) throw Error('EXPECTED_DB_FINGERPRINT_MISMATCH');
      const reportName = write
        ? 'rollback-apply-plan.json'
        : plan.status === 'ROLLED_BACK'
          ? 'rollback-status.json'
          : 'rollback-plan.json';
      await output(reportName, plan, {
        operation: plan.operation,
        batchId: plan.batchId,
        planHash: plan.completedRollback?.planHash ?? plan.planHash,
        status: plan.status,
        ownedTargets: plan.targets.length,
        blockers: plan.blockers,
      });
      if (plan.blockers.length) {
        deps.report({ error: 'MANUAL_RECONCILIATION_REQUIRED', blockers: plan.blockers });
        return 1;
      }
      if (write) {
        const reviewed = await deps.readReviewedRollback(v['out-dir']!);
        if (
          v['plan-hash'] !== reviewed.planHash ||
          reviewed.batchId !== plan.batchId ||
          reviewed.dbIdentity !== plan.dbIdentity ||
          reviewed.manifestHash !== plan.manifestHash ||
          reviewed.codeRevision !== plan.codeRevision ||
          (plan.status !== 'ROLLED_BACK' && plan.planHash !== reviewed.planHash)
        )
          throw Error('REVIEWED_ROLLBACK_PLAN_CHANGED');
        const receipt = await deps.rollback(reviewed, (state) => deps.report(state));
        await output('rollback-receipt.json', receipt);
      }
      return 0;
    }
    if (mode === 'reconcile') {
      if (!v['batch-id']) throw Error('BATCH_ID_REQUIRED');
      const report = await deps.reconcile(v['batch-id'], v.manifest);
      if (kind && report.kind !== kind) throw Error('BATCH_KIND_MISMATCH');
      await output('reconciliation.json', report);
      return report.canOpen ? 0 : 1;
    }
    const p = await deps.prepare(v.manifest, v.decisions, kind, id.fingerprint, write);
    const summary = planReport(p);
    await output(
      write ? 'apply-plan.json' : 'dry-run.json',
      p.kind === 'STOCK' && v['out-dir'] ? planReport(p, true) : summary,
      summary,
    );
    if (p.issues.length || p.totals.conflicts || !hasVerifiedSource(p.reconciliationSnapshot))
      throw Error('SOURCE_OR_PLAN_BLOCKED');
    if (write) {
      if (p.planHash !== v['plan-hash'] || p.dbIdentity !== id.fingerprint)
        throw Error('REVIEWED_PLAN_CHANGED');
      const receipt = await deps.apply(p);
      await output('apply-receipt.json', receipt);
      const verified = await deps.verify(receipt.batchId, p.planHash);
      await output('verification.json', verified);
      if (!verified.canOpen) return 1;
    }
    return 0;
  } catch (e) {
    const message = e instanceof Error ? e.message : '';
    // Third-party exceptions may contain source paths, row payloads or connection strings.
    deps.report({
      ...(message === 'TARGET_IN_USE' || message === 'TARGET_CHANGED'
        ? { action: 'MANUAL_RECONCILIATION_REQUIRED' }
        : {}),
      error: /^[A-Z][A-Z0-9_]{2,75}$/.test(message) ? message : 'CUTOVER_INPUT_OR_DATABASE_ERROR',
    });
    return 1;
  }
}

export function checkoutRevision(write: boolean, checkout = __dirname, entry = __filename) {
  return readCheckoutRevision(write, checkout, entry);
}

const attestForwardRevision = bindWriterRevision(() => checkoutRevision(true));

export function cliDependencies(
  client: () => PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
  revision: (write: boolean) => string = (write) =>
    write ? attestForwardRevision() : checkoutRevision(false),
): CliDependencies {
  return {
    env,
    identity: () => readImportDatabaseIdentity(client()),
    async verifySocket(id) {
      try {
        const url = new URL(env.DATABASE_URL ?? '');
        if (
          !['postgres:', 'postgresql:'].includes(url.protocol) ||
          url.hostname !== 'localhost' ||
          url.searchParams.get('host') !== id.host ||
          url.pathname !== '/' + id.database ||
          url.port !== id.port ||
          url.searchParams.get('schema') !== id.schema
        )
          return false;
        return (await stat(join(id.host, '.s.PGSQL.' + id.port))).isSocket();
      } catch {
        return false;
      }
    },
    async prepare(path, decisions, kind, identity, write) {
      const inputs = await loadSourceInputs(path, decisions, revision(write), identity);
      const selected = kind
        ? inputs.find((i) => i.kind === kind)
        : inputs.length === 1
          ? inputs[0]
          : null;
      if (!selected) throw Error('SOURCE_KIND_REQUIRED_OR_MISSING');
      const plan = await buildImportPlan(client(), selected);
      // The source loader shares upstream diagnostics across kinds. Keep source-free
      // upstream issues global and mark genuinely kind-specific planner findings.
      const shared = new Set(selected.issues);
      const key = (i: ImportPlan['issues'][number]) =>
        hashImportValue([i.kind ?? null, i.code, i.source]);
      const known = new Set<string>();
      const append = (issue: ImportPlan['issues'][number], kind: SourceKind) => {
        const scoped = shared.has(issue) || issue.kind ? issue : { ...issue, kind };
        const id = key(scoped);
        if (!known.has(id)) {
          known.add(id);
          plan.issues.push(scoped);
        }
      };
      const selectedIssues = plan.issues;
      plan.issues = [];
      for (const issue of selectedIssues) append(issue, selected.kind);
      for (const other of inputs.filter((i) => i !== selected)) {
        const sibling = await buildImportPlan(client(), other);
        const siblingBlocked = sibling.issues.some(
          (issue) => !issue.kind || issue.kind === sibling.kind,
        );
        if (siblingBlocked || !hasVerifiedSource(sibling.reconciliationSnapshot)) {
          for (const issue of sibling.issues) append(issue, sibling.kind);
          append(
            {
              kind: sibling.kind,
              code: 'COMPANION_SOURCE_BLOCKED',
              source: null,
              message: 'COMPANION_SOURCE_BLOCKED',
            },
            sibling.kind,
          );
        }
      }
      return plan;
    },
    apply(plan) {
      if (revision(true) !== plan.codeRevision) throw Error('CODE_REVISION_CHANGED');
      return applyBatch(client(), plan, (tx, i) =>
        i.kind === 'SALES' ? writeSalesItem(tx, i) : writeStockItem(tx, i),
      );
    },
    async rollbackPlan(batchId, path, write) {
      const plan = await planRollback(client(), batchId, revision(write));
      if (hashImportValue(await loadManifest(path)) !== plan.manifestHash)
        throw Error('BATCH_MANIFEST_MISMATCH');
      return plan;
    },
    async readReviewedRollback(dir) {
      if (((await stat(dir)).mode & 0o077) !== 0) throw Error('PRIVATE_OUTPUT_DIRECTORY_REQUIRED');
      const file = await open(
        join(dir, 'rollback-plan.json'),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const info = await file.stat();
        if (!info.isFile() || info.mode & 0o077) throw Error('PRIVATE_REVIEWED_PLAN_REQUIRED');
        return parseReviewedRollback(JSON.parse(await file.readFile('utf8')));
      } finally {
        await file.close();
      }
    },
    rollback(plan, waiting) {
      if (revision(true) !== plan.codeRevision) throw Error('CODE_REVISION_CHANGED');
      return applyRollback(client(), plan, waiting);
    },
    verify: (id, hash) => verifyAppliedBatch(client(), id, hash),
    async reconcile(batchId, path) {
      const batch = await client().tooltifyImportBatch.findUniqueOrThrow({
        where: { id: batchId },
        select: { manifestHash: true },
      });
      if (hashImportValue(await loadManifest(path)) !== batch.manifestHash)
        throw Error('BATCH_MANIFEST_MISMATCH');
      return reconcileBatch(client(), batchId);
    },
    inspect,
    save: (dir, name, value) =>
      privateOutput(dir, [{ name, content: JSON.stringify(value, null, 2) + '\n' }]),
    report: (value) => console.log(JSON.stringify(value)),
  };
}
export async function cutoverMain(args = process.argv.slice(2), legacyKind?: SourceKind) {
  let db: PrismaClient | undefined;
  const deps = cliDependencies(() => {
    if (!db && args.includes('rollback')) {
      const url = new URL(process.env.DATABASE_URL ?? '');
      url.searchParams.set('connection_limit', '1');
      db = new PrismaClient({ datasourceUrl: url.toString() });
    }
    return (db ??= new PrismaClient());
  });
  try {
    if (
      legacyKind &&
      !args.includes('--manifest') &&
      !args.some((a) => a.startsWith('--manifest='))
    ) {
      console.error('MANIFEST_REQUIRED');
      return 1;
    }
    if (legacyKind && args.some((a) => a === '--source-kind' || a.startsWith('--source-kind='))) {
      const { values } = parseArgs({
        args,
        allowPositionals: true,
        strict: false,
        options: { 'source-kind': { type: 'string', multiple: true } },
      });
      if (
        values['source-kind']?.some(
          (k) => k !== (legacyKind === 'STOCK' ? 'current-stock-snapshot' : 'sales'),
        )
      ) {
        console.error('LEGACY_SOURCE_KIND_MISMATCH');
        return 1;
      }
    }
    const options = legacyKind
      ? ['--source-kind', legacyKind === 'STOCK' ? 'current-stock-snapshot' : 'sales', ...args]
      : args;
    return await runCutover(options, deps);
  } finally {
    await db?.$disconnect();
  }
}
if (require.main === module)
  void cutoverMain()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error('CUTOVER_FAILED');
      process.exitCode = 1;
    });
