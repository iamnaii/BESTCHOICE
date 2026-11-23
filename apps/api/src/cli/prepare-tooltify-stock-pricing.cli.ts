import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { hashSourceDecisions } from './tooltify-cutover/canonicalize';
import { prepareMasterDecisions } from './tooltify-cutover/prepare-master-decisions';
import { loadManifest, loadSourceInputs } from './tooltify-cutover/source-input';
import type { SourceDecisions } from './tooltify-cutover/types';

/** File-only preparation. Creates a fresh review directory; never edits applied manifests or DB rows. */
async function main() {
  const { values: v } = parseArgs({
    options: {
      manifest: { type: 'string' },
      'out-dir': { type: 'string' },
      'store-key': { type: 'string' },
      'default-origin': { type: 'string' },
      'origin-evidence': { type: 'string' },
    },
  });
  if (
    !v.manifest ||
    !v['out-dir'] ||
    !v['store-key'] ||
    !v['origin-evidence'] ||
    (v['default-origin'] !== 'THAI' && v['default-origin'] !== 'IMPORTED')
  )
    throw Error(
      'Usage: --manifest FILE --out-dir NEW_DIRECTORY --store-key STORE --default-origin THAI|IMPORTED --origin-evidence FILE',
    );
  const path = resolve(v.manifest),
    out = resolve(v['out-dir']);
  const evidence = await readFile(resolve(v['origin-evidence']));
  const evidenceSha256 = createHash('sha256').update(evidence).digest('hex');
  const evidenceRef = join(out, 'origin-evidence');
  const inputs = await loadSourceInputs(path, undefined, 'PREPARATION_ONLY', 'NO_DATABASE');
  const stocks = inputs.filter((i) => i.kind === 'STOCK');
  if (stocks.length !== 1 || stocks[0].issues.length) throw Error('RESOLVE_SOURCE_ISSUES_FIRST');
  const manifest = await loadManifest(path);
  const prior: SourceDecisions = JSON.parse(
    await readFile(join(dirname(path), 'source-decisions.json'), 'utf8'),
  );
  const decisions = prepareMasterDecisions(stocks[0].rows, prior, {
    storeKey: v['store-key'],
    defaultOrigin: v['default-origin'],
    evidenceRef,
    evidenceSha256,
  });
  decisions.entries = decisions.entries.map((d) => ({
    ...d,
    evidenceRef: resolve(dirname(path), d.evidenceRef),
  }));
  if (manifest.history)
    manifest.history = manifest.history.map((h) => ({
      ...h,
      evidenceRef: resolve(dirname(path), h.evidenceRef),
    }));
  // Existing paths are interpreted by the cutover loader from cwd, not manifest dirname.
  manifest.files = manifest.files.map((f) => ({ ...f, path: resolve(f.path) }));
  if (manifest.copies)
    manifest.copies = manifest.copies.map((f) => ({ ...f, path: resolve(f.path) }));
  manifest.decisionsSha256 = hashSourceDecisions(decisions);
  await mkdir(out, { mode: 0o700 }); // Fails if already present, protecting prior receipts and reviewed plans.
  await writeFile(evidenceRef, evidence, { mode: 0o600 });
  await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  await writeFile(join(out, 'source-decisions.json'), JSON.stringify(decisions, null, 2), {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      prepared: true,
      outDir: out,
      next: 'Run cutover dry-run, review prices/origins, then apply the reviewed plan.',
    }),
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'PREPARATION_FAILED');
  process.exitCode = 1;
});
