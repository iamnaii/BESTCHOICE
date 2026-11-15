import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// Repo root, derived from this file (apps/web/src/components/ui) so the scan does
// not depend on the directory vitest was launched from.
const ROOT = resolve(__dirname, '../../../../..');
const WEB_SRC = resolve(ROOT, 'apps/web/src');
const SKIP_DIRS = new Set(['__tests__', 'test', 'tests', 'node_modules', 'dist']);
const SOURCE_FILE = /\.[jt]sx?$/;
const TEST_FILE = /[.-](test|spec|docs-spec)\.[jt]sx?$/;
// Plain text scan over the whole frontend tree; keep a generous ceiling so a busy
// CI runner cannot turn a guard test into a deploy blocker.
const SCAN_TIMEOUT_MS = 30_000;

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) listSourceFiles(file, out);
    } else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      out.push(file);
    }
  }
  return out;
}

/** Repo-relative path with forward slashes — `relative()` returns backslashes on Windows. */
function repoPath(file: string): string {
  return relative(ROOT, file).split(sep).join('/');
}

/** Production files under apps/web/src whose text matches `pattern`, sorted. */
function filesMatching(pattern: RegExp): string[] {
  const files = listSourceFiles(WEB_SRC);
  // Guard against the scan silently walking the wrong tree and passing vacuously.
  expect(files.length).toBeGreaterThan(500);
  return files
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map(repoPath)
    .sort();
}

// Tailwind 3 spelled a bare CSS variable as `w-[--x]`. Tailwind 4 reads that as the
// literal value `--x` (invalid CSS) and the class silently does nothing — popover menus
// fell back to w-72 instead of matching their trigger. Write `w-(--x)` (or `w-[var(--x)]`).
const BARE_CSS_VAR_ARBITRARY = /-\[--[a-z]/;

// `--input` is the border token. As a field background it renders mid-grey, so an
// editable field looks disabled. Fields use formControlClass (bg-background) instead.
const BG_INPUT = /(?<![\w-])bg-input\b/;
const BG_INPUT_ALLOWED = new Set([
  'apps/web/src/components/ui/switch.tsx', // switch track (unchecked state)
  'apps/web/src/components/ui/input-otp.tsx', // dark:bg-input/30 on the OTP slot
]);

describe('field guards (source scan)', () => {
  it(
    'never uses a Tailwind 3 bare CSS-variable arbitrary value such as w-[--x]',
    () => {
      expect(filesMatching(BARE_CSS_VAR_ARBITRARY)).toEqual([]);
    },
    SCAN_TIMEOUT_MS,
  );

  it(
    'uses bg-input only for the switch track and the OTP slot, never as a field background',
    () => {
      const offenders = filesMatching(BG_INPUT).filter((file) => !BG_INPUT_ALLOWED.has(file));
      expect(offenders).toEqual([]);
    },
    SCAN_TIMEOUT_MS,
  );
});
