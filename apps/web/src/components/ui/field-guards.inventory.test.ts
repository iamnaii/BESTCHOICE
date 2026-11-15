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
// warning outline on tone. Class text is read from string literals, template text, cn()/clsx()
// arguments (including object keys and array items), both branches of ?:, && / || / ?? operands,
// and through `as` / `satisfies` / `!` / parentheses. A plain identifier (className={formControlClass})
// is allowed and not resolved. Any other expression kind cannot be read, so it FAILS the guard
// with its file:line instead of being skipped silently.

/** Variant prefixes such as hover:, data-[state=open]:, group-hover/i:, [&:hover]: end at the last top-level colon. */
function stripVariants(token: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i += 1) {
    const ch = token[i];
    if (ch === '[' || ch === '(') depth += 1;
    else if (ch === ']' || ch === ')') depth -= 1;
    else if (ch === ':' && depth === 0) start = i + 1;
  }
  return token.slice(start);
}

const SKIN_BASE =
  /^(?:rounded(?:-\S+)?|border-border|bg-\S+|p[xylrtbse]?-\S+|\[(?:border-radius|padding(?:-[a-z]+)*|background(?:-[a-z]+)*)\s*:[^\]]*\])$/;

/** True when one class token (any variant, `!` important prefix or suffix) is radius, border colour, fill or padding. */
function isNativeSelectSkinToken(token: string): boolean {
  const base = stripVariants(token).replace(/^!/, '').replace(/!$/, '');
  return SKIN_BASE.test(base);
}

const NATIVE_SELECT_CANDIDATE = /<NativeSelect\b/;

interface ClassCollection {
  strings: string[];
  unreadable: { line: number; kind: string }[];
}

function collectClassStrings(node: ts.Node, ast: ts.SourceFile, out: ClassCollection): void {
  const lineOf = (n: ts.Node) => ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1;
  const walk = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      out.strings.push(n.text);
    } else if (ts.isTemplateExpression(n)) {
      out.strings.push(n.head.text);
      for (const span of n.templateSpans) {
        walk(span.expression);
        out.strings.push(span.literal.text);
      }
    } else if (ts.isJsxExpression(n)) {
      if (n.expression) walk(n.expression);
    } else if (ts.isCallExpression(n)) {
      n.arguments.forEach(walk);
    } else if (ts.isConditionalExpression(n)) {
      walk(n.whenTrue); // the condition is not class text
      walk(n.whenFalse);
    } else if (ts.isBinaryExpression(n)) {
      // `cond && 'x'`: the left side is a condition, not class text
      if (n.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) walk(n.left);
      walk(n.right);
    } else if (ts.isObjectLiteralExpression(n)) {
      for (const property of n.properties) {
        const name = ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property) ? property.name : null;
        if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))) {
          out.strings.push(name.text);
        } else if (name && ts.isComputedPropertyName(name)) {
          walk(name.expression);
        } else {
          out.unreadable.push({ line: lineOf(property), kind: ts.SyntaxKind[property.kind] });
        }
      }
    } else if (ts.isArrayLiteralExpression(n)) {
      n.elements.forEach(walk);
    } else if (ts.isSpreadElement(n)) {
      walk(n.expression);
    } else if (
      ts.isParenthesizedExpression(n) ||
      ts.isAsExpression(n) ||
      ts.isSatisfiesExpression(n) ||
      ts.isNonNullExpression(n) ||
      ts.isTypeAssertionExpression(n)
    ) {
      walk(n.expression);
    } else if (
      ts.isIdentifier(n) ||
      ts.isNumericLiteral(n) ||
      n.kind === ts.SyntaxKind.TrueKeyword ||
      n.kind === ts.SyntaxKind.FalseKeyword ||
      n.kind === ts.SyntaxKind.NullKeyword
    ) {
      // a class held in a variable is out of scope; flags and numbers carry no class text
    } else {
      out.unreadable.push({ line: lineOf(n), kind: ts.SyntaxKind[n.kind] });
    }
  };
  walk(node);
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
        const collected: ClassCollection = { strings: [], unreadable: [] };
        collectClassStrings(attribute.initializer, ast, collected);
        for (const item of collected.unreadable) {
          found.push(
            `${where}:${item.line} NativeSelect className uses an expression the guard cannot read (${item.kind}); use literal class text or a plain identifier`,
          );
        }
        const skin = collected.strings
          .flatMap((text) => text.split(/\s+/))
          .filter((token) => token && isNativeSelectSkinToken(token));
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
  it('matches radius, border colour, fill and padding in every spelling', () => {
    const skin = [
      'rounded',
      'rounded-md',
      'hover:rounded-lg',
      '!rounded-md',
      'rounded-md!',
      'data-[state=open]:rounded-md',
      'group-hover/i:bg-card',
      '[&:hover]:px-2',
      'md:hover:!py-1',
      'border-border',
      'bg-card',
      'p-2',
      'px-3',
      'py-2',
      'pl-9',
      'pr-9',
      'pt-1',
      'pb-1',
      'ps-2',
      'pe-2',
      '[border-radius:8px]',
      '[padding:4px]',
      '[padding-left:4px]',
      '[background:red]',
      'md:[background-color:red]',
    ];
    for (const token of skin) expect(isNativeSelectSkinToken(token), token).toBe(true);
    const clean = [
      'border-warning',
      'font-mono',
      'font-medium',
      'w-40',
      'sm:w-48',
      'min-w-0',
      'text-right',
      'pointer-events-none',
      'data-[state=open]:font-medium',
      '[&:hover]:font-mono',
      '[width:10px]',
    ];
    for (const token of clean) expect(isNativeSelectSkinToken(token), token).toBe(false);
  });

  it('reads cn()/clsx() objects, arrays and casts, and fails on expressions it cannot read', () => {
    const sample = resolve(ROOT, 'apps/web/src/__guard-sample__.tsx');
    const run = (className: string) => nativeSelectSkinViolations(sample, `<NativeSelect className=${className} />`);
    expect(run('{cn("rounded-md", ok && `px-2 ${extra}`)}')).toEqual([expect.stringMatching(/:1 rounded-md px-2$/)]);
    expect(run('{cn({ "rounded-md": on })}')).toEqual([expect.stringMatching(/:1 rounded-md$/)]);
    expect(run('{clsx(["bg-card", cond ? "p-2" : undefined])}')).toEqual([expect.stringMatching(/:1 bg-card p-2$/)]);
    expect(run('{("!rounded-md" as string)}')).toEqual([expect.stringMatching(/:1 !rounded-md$/)]);
    expect(run('{("[padding:4px]" satisfies string)!}')).toEqual([expect.stringMatching(/:1 \[padding:4px\]$/)]);
    // not class text, or out of scope
    expect(run('{formControlClass}')).toEqual([]);
    expect(run('{isDirty ? "border-warning" : ""}')).toEqual([]);
    expect(run('{cn(a.b > 1 && "font-mono", "w-40 sm:w-48")}')).toEqual([]);
    // unreadable expression kinds fail loudly, naming file:line
    for (const expr of ['{styles.field}', '{map[key]}', '{!on}', '{tag`x`}', '{cn(styles.field)}']) {
      const result = run(expr);
      expect(result, expr).toHaveLength(1);
      expect(result[0]).toMatch(/__guard-sample__\.tsx:1 NativeSelect className uses an expression the guard cannot read/);
    }
  });

  it(
    'NativeSelect className never carries radius, border colour, fill or padding',
    () => {
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

// --- same-row siblings keep their size (Task 9 fix round 1) ---------------------------------
// formControlClass carries w-full. An input that sits next to a select in a `flex flex-wrap`
// filter row and had no width class before must say `w-auto`, or it stretches to the whole row
// and pushes the select onto a new line (measured: commissions month 166 -> 1314px, collections
// search 260 -> 1314px at 1440).
describe('flex-wrap filter rows: siblings of NativeSelect keep w-auto', () => {
  const sites: { file: string; pattern: RegExp; count: number }[] = [
    {
      file: 'apps/web/src/pages/CollectionsPage/components/CollectionsFilters.tsx',
      pattern: /cn\(formControlClass, 'w-auto min-w-\[260px\]'\)/g,
      count: 1,
    },
    {
      file: 'apps/web/src/pages/CollectionsPage/tabs/AllTab.tsx',
      pattern: /cn\(formControlClass, 'w-auto min-w-\[250px\]'\)/g,
      count: 1,
    },
    {
      file: 'apps/web/src/pages/CommissionsPage.tsx',
      pattern: /cn\(formControlClass, 'w-auto'\)/g,
      count: 2,
    },
  ];
  for (const site of sites) {
    it(`${site.file} keeps w-auto`, () => {
      const source = readFileSync(resolve(ROOT, site.file), 'utf8');
      expect(source.match(site.pattern)?.length ?? 0).toBe(site.count);
      // no bare formControlClass left on the month inputs of the commissions page
      if (site.file.endsWith('CommissionsPage.tsx')) {
        expect(source).not.toMatch(/type="month"[\s\S]{0,200}className=\{formControlClass\}/);
      }
    });
  }
});
