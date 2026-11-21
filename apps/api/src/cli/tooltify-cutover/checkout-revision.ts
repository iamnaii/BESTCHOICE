import { execFileSync } from 'node:child_process';
import { lstatSync, readlinkSync, realpathSync, type Stats } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

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
    // The operator keeps these root locations fixed for the process lifetime.
    // A linked checkout can have a separate administrative and common directory.
    const roots = [
      realpathSync(root),
      realpathSync(git('rev-parse', '--absolute-git-dir')),
      realpathSync(git('rev-parse', '--path-format=absolute', '--git-common-dir')),
    ].sort((a, b) => a.length - b.length);
    const checked = new Set<string>();
    function checkPath(path: string, required = true): boolean {
      if (checked.has(path)) return true;
      const absolute = resolve(path);
      const owner = roots.find((base) => absolute === base || absolute.startsWith(base + sep));
      if (!owner) throw restart();
      // A moved directory can contain entirely old leaves. Check the ancestry
      // to the outermost owning root, including that root, once per pass.
      if (path !== owner) checkPath(dirname(path), required);
      const info = lstatSync(path, { throwIfNoEntry: false });
      if (!info && !required) return false;
      if (!info || !predatesProcess(info)) throw restart();
      checked.add(path);
      if (info.isSymbolicLink()) {
        checkPath(realpathSync(path));
        // Preserve '..' when checking intermediate links in the stored target.
        const target = readlinkSync(path);
        checkPath(isAbsolute(target) ? target : dirname(path) + sep + target);
      }
      return true;
    }
    const files = execFileSync('git', ['--no-optional-locks', '-C', root, 'ls-files', '-z'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    for (const name of files.split('\0')) {
      if (name) checkPath(join(root, name));
    }
    const ref = git('rev-parse', '--symbolic-full-name', 'HEAD');
    const metadata = (name: string) =>
      git('rev-parse', '--path-format=absolute', '--git-path', name);
    checkPath(join(root, '.git'));
    checkPath(metadata('HEAD'));
    const seen = (name: string) => checkPath(metadata(name), false);
    seen('commondir');
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
    // A status index refresh creates index.lock and changes the Git directory
    // that rollback must attest. Keep these read operations free of that lock.
    execFileSync('git', ['--no-optional-locks', '-C', checkout, ...args], {
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
