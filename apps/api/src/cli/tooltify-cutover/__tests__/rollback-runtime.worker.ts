// Child process for the real-checkout fixture. The parent owns the temporary Git
// repository. Only this worker holds a client in the isolated DB during freeze.
import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { frozen, harnessClient } from './rollback-fixtures';
import type { RollbackPlan } from '../types';

async function main() {
  const [repo, batchId, scenario, planFile] = process.argv.slice(2);
  const src = join(repo, 'apps/api/src/cli/tooltify-cutover');
  const file = join(src, 'rollback.ts'),
    dependency = join(src, 'canonicalize.ts');
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  function moveCheckout(marker: string) {
    const source = readFileSync(file, 'utf8').replace(
      /fixtureSource = '[AB]'/,
      "fixtureSource = '" + marker + "'",
    );
    writeFileSync(file, source);
    git('add', '.');
    git('commit', '-qm', marker);
  }
  const original = readFileSync(dependency, 'utf8');
  const scope = globalThis as typeof globalThis & { tooltifyFixtureImportHook?: () => void };
  if (scenario === 'race') scope.tooltifyFixtureImportHook = () => moveCheckout('B');
  if (scenario === 'unrelated-sibling')
    scope.tooltifyFixtureImportHook = () => writeFileSync(join(repo, '..', 'sibling'), 'fixture');
  if (scenario === 'directory-restore') {
    scope.tooltifyFixtureImportHook = () => {
      const sourceTree = join(repo, 'apps/api/src');
      renameSync(sourceTree, join(repo, 'plans', 'loaded-src'));
      renameSync(join(repo, 'plans', 'reviewed-src'), sourceTree);
    };
  }
  if (scenario === 'ref-race')
    scope.tooltifyFixtureImportHook = () => git('commit', '--allow-empty', '-qm', 'Ref only');
  if (scenario === 'dependency-race') {
    writeFileSync(
      dependency,
      original.replace("fixtureDependency = 'clean'", "fixtureDependency = 'changed'"),
    );
    scope.tooltifyFixtureImportHook = () => writeFileSync(dependency, original);
  }
  if (scenario === 'loaded-dirty')
    writeFileSync(file, readFileSync(file, 'utf8') + '\n// dirty load');
  const entry =
    scenario === 'compiled'
      ? 'compiled.cjs'
      : scenario === 'untracked'
        ? 'untracked.ts'
        : 'rollback.ts';
  const nativeRequire = createRequire(__filename);
  const writer: typeof import('../rollback') & { fixtureSource: string } = nativeRequire(
    join(src, entry),
  );
  if (scenario === 'loaded-dirty') git('restore', '--', file);
  if (scenario === 'dirty')
    writeFileSync(file, readFileSync(file, 'utf8') + '\n// changed after load');
  if (scenario === 'move') moveCheckout('C');
  const db = harnessClient();
  try {
    await db.$queryRaw`SELECT 1`;
    const reviewed: RollbackPlan = planFile
      ? JSON.parse(readFileSync(planFile, 'utf8'))
      : await writer.planRollback(db, batchId);
    let result;
    try {
      result = { receipt: await frozen(() => writer.applyRollback(db, reviewed)) };
    } catch (error) {
      result = { error: error instanceof Error ? error.message : String(error) };
    }
    console.log(JSON.stringify({ source: writer.fixtureSource, reviewed, ...result }));
  } finally {
    await db.$disconnect();
    if (scenario === 'dirty') git('restore', '--', file);
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
