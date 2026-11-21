import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync, statSync, type Stats } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';

// Node reads module bytes before evaluating their imports. A clean HEAD observed
// during evaluation can therefore postdate the code in memory. A rollback runtime
// must start after the worktree and its effective ref last changed.
function assertRollbackProcessFresh(root: string, git: (...args: string[]) => string) {
  // Round down to a whole second: a coarse filesystem timestamp in the startup
  // second cannot distinguish a change before process launch from one after.
  const before = Math.floor(performance.timeOrigin / 1000) * 1000;
  const predatesProcess = (s: Stats) =>
    [s.mtimeMs, s.ctimeMs].every((time) => time > 0 && time < before);
  const restart = () => Error('ROLLBACK_FRESH_PROCESS_REQUIRED');
  try {
    if (!Number.isFinite(before) || before > Date.now()) throw restart();
    const files = execFileSync('git', ['-C', root, 'ls-files', '-z'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    for (const name of files.split('\0')) {
      if (!name) continue;
      const path = join(root, name),
        info = lstatSync(path);
      if (!predatesProcess(info) || (info.isSymbolicLink() && !predatesProcess(statSync(path))))
        throw restart();
    }
    const ref = git('rev-parse', '--symbolic-full-name', 'HEAD');
    const metadata = (name: string) =>
      git('rev-parse', '--path-format=absolute', '--git-path', name);
    if (!predatesProcess(statSync(metadata('HEAD')))) throw restart();
    const seen = (name: string) => {
      const info = statSync(metadata(name), { throwIfNoEntry: false });
      if (info && !predatesProcess(info)) throw restart();
      return !!info;
    };
    seen('logs/HEAD');
    const packed = seen('packed-refs');
    const reftable = seen('reftable/tables.list');
    if (ref !== 'HEAD') {
      seen('logs/' + ref);
      if (!seen(ref) && !packed && !reftable) throw restart();
    }
  } catch {
    throw restart();
  }
}

export function readCheckoutRevision(
  write: boolean,
  checkout: string,
  entry?: string,
  sourcePath:
    | 'apps/api/src/cli/tooltify-cutover.cli.ts'
    | 'apps/api/src/cli/tooltify-cutover/rollback.ts' = 'apps/api/src/cli/tooltify-cutover.cli.ts',
) {
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', checkout, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  if (write) {
    const tracked = git('ls-files', '--full-name', '--', ':(top)' + sourcePath);
    if (
      !entry ||
      tracked !== sourcePath ||
      realpathSync(entry) !== join(realpathSync(git('rev-parse', '--show-toplevel')), sourcePath)
    )
      throw Error('TRACKED_SOURCE_ENTRY_REQUIRED');
  }
  const clean = !git('status', '--porcelain', '--untracked-files=normal');
  if (write && !clean) throw Error('CLEAN_REVIEWED_CHECKOUT_REQUIRED');
  const revision = git('rev-parse', 'HEAD');
  if (write && sourcePath === 'apps/api/src/cli/tooltify-cutover/rollback.ts') {
    assertRollbackProcessFresh(git('rev-parse', '--show-toplevel'), git);
    if (git('rev-parse', 'HEAD') !== revision) throw Error('ROLLBACK_FRESH_PROCESS_REQUIRED');
  }
  return revision + (clean ? '' : '-dirty');
}
