import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import ts from 'typescript';
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

// --- NativeSelect owns its skin (spec 2026-11-14 §4.2 item 5) -------------------------------
// NativeSelect renders cn(formControlClass, className, <size tail>), so a caller's radius,
// border colour, fill or padding silently replaces the shared skin (the 2026-11-14 scan found
// 128 such call sites). Width belongs on wrapperClassName, icon gutters on leadingIcon and the
// warning outline on tone. Only literal class text is inspected: string literals, cn()/clsx()
// arguments, both branches of ?:, &&/|| operands and template-literal text. A class held in a
// variable (className={inputClass}) is not resolved.
const NATIVE_SELECT_SKIN =
  /^(?:[a-z0-9-]+:)*(?:rounded(?:-\S+)?|border-border|bg-\S+|p-\S+|px-\S+|py-\S+|pl-\S+|pr-\S+)$/;
const NATIVE_SELECT_CANDIDATE = /<NativeSelect\b/;

function collectClassStrings(node: ts.Node, out: string[]): void {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    out.push(node.text);
    return;
  }
  if (ts.isTemplateExpression(node)) {
    out.push(node.head.text);
    for (const span of node.templateSpans) {
      collectClassStrings(span.expression, out);
      out.push(span.literal.text);
    }
    return;
  }
  if (ts.isJsxExpression(node)) {
    if (node.expression) collectClassStrings(node.expression, out);
    return;
  }
  if (ts.isCallExpression(node)) {
    for (const arg of node.arguments) collectClassStrings(arg, out);
    return;
  }
  if (ts.isConditionalExpression(node)) {
    collectClassStrings(node.whenTrue, out);
    collectClassStrings(node.whenFalse, out);
    return;
  }
  if (ts.isBinaryExpression(node)) {
    collectClassStrings(node.left, out);
    collectClassStrings(node.right, out);
    return;
  }
  if (ts.isParenthesizedExpression(node)) collectClassStrings(node.expression, out);
}

function nativeSelectSkinViolations(file: string, source: string): string[] {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const where = relative(ROOT, file).split(sep).join('/');
  const found: string[] = [];
  const inspect = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(ast) === 'NativeSelect'
    ) {
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText(ast) !== 'className') continue;
        if (!attribute.initializer) continue;
        const strings: string[] = [];
        collectClassStrings(attribute.initializer, strings);
        const skin = strings
          .flatMap((text) => text.split(/\s+/))
          .filter((token) => NATIVE_SELECT_SKIN.test(token));
        if (skin.length) {
          const line = ast.getLineAndCharacterOfPosition(attribute.getStart(ast)).line + 1;
          found.push(`${where}:${line} ${skin.join(' ')}`);
        }
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(ast);
  return found;
}

describe('NativeSelect skin guard', () => {
  it(
    'NativeSelect className never carries radius, border colour, fill or padding',
    () => {
      // The detector itself: cn() args and template text are read; tone/width classes pass.
      const sample = resolve(ROOT, 'apps/web/src/__guard-sample__.tsx');
      const caught = nativeSelectSkinViolations(
        sample,
        '<NativeSelect className={cn("rounded-md", ok && `px-2 ${extra}`)} />',
      );
      expect(caught).toHaveLength(1);
      expect(caught[0]).toMatch(/:1 rounded-md px-2$/);
      expect(
        nativeSelectSkinViolations(
          sample,
          '<NativeSelect className={isDirty ? "border-warning" : ""} wrapperClassName="sm:w-56" />',
        ),
      ).toEqual([]);

      const files = listSourceFiles(resolve(ROOT, 'apps/web/src'));
      expect(files.length).toBeGreaterThan(500);
      const found: string[] = [];
      for (const file of files) {
        const source = readFileSync(file, 'utf8');
        if (!NATIVE_SELECT_CANDIDATE.test(source)) continue;
        found.push(...nativeSelectSkinViolations(file, source));
      }
      expect(found).toEqual([]);
    },
    SCAN_TIMEOUT_MS,
  );
});
