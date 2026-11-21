import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';

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
  return git('rev-parse', 'HEAD') + (clean ? '' : '-dirty');
}
