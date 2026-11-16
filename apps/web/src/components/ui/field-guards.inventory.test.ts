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

// ── R1-4 · §4.3 — ป้ายแบบ A (label style A) ─────────────────────────────────────
// Local helpers + dynamic node imports; the tags are read with the TypeScript parser and their
// className text with collectClassStrings (the NativeSelect guard above), so an attribute order,
// a line break or a className={cn(...)} expression cannot hide an override.

// Classes that change a label's size or spacing (any variant, `!` important): font size, case,
// tracking, leading, margin, display:block.
const LABEL_SIZE_OR_SPACING =
  /^-?(?:text-(?:2xs|xs|sm|base|lg|xl|[2-9]xl|\[\d+(?:\.\d+)?(?:px|r?em)\])|uppercase|tracking-\S+|leading-\S+|m[tbyxlrse]?-\S+|block)$/;

function isLabelSizeOrSpacingToken(token: string): boolean {
  return LABEL_SIZE_OR_SPACING.test(stripVariants(token).replace(/^!/, '').replace(/!$/, ''));
}

interface JsxTag {
  line: number;
  attributes: Map<string, ts.JsxAttribute>;
}

/** Every JSX opening / self-closing tag named one of `names`, with its attributes by name. */
function jsxTagsNamed(ast: ts.SourceFile, names: string[]): JsxTag[] {
  const tags: JsxTag[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      names.includes(node.tagName.getText(ast))
    ) {
      const attributes = new Map<string, ts.JsxAttribute>();
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute)) attributes.set(attribute.name.getText(ast), attribute);
      }
      tags.push({
        line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
        attributes,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return tags;
}

/** Size/spacing classes a className adds, whether it names formLabelClass, and whether all of it was readable. */
function labelClassName(attribute: ts.JsxAttribute | undefined, ast: ts.SourceFile) {
  const collected: ClassCollection = { strings: [], unreadable: [] };
  let usesStyleA = false;
  if (attribute?.initializer) {
    collectClassStrings(attribute.initializer, ast, collected);
    const find = (node: ts.Node) => {
      if (ts.isIdentifier(node) && node.text === 'formLabelClass') usesStyleA = true;
      ts.forEachChild(node, find);
    };
    find(attribute.initializer);
  }
  const added = collected.strings
    .flatMap((text) => text.split(/\s+/))
    .filter((token) => token && isLabelSizeOrSpacingToken(token));
  return { added, usesStyleA, readable: collected.unreadable.length === 0 };
}

const parseTsx = (file: string, source: string) =>
  ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** `<file>:<line> …` for every FormLabel whose className changes the default (style A) size or spacing. */
function formLabelOverrides(file: string, source: string): string[] {
  const ast = parseTsx(file, source);
  const found: string[] = [];
  for (const tag of jsxTagsNamed(ast, ['FormLabel'])) {
    const className = tag.attributes.get('className');
    if (!className) continue;
    const { added, readable } = labelClassName(className, ast);
    if (!readable)
      found.push(
        `${file}:${tag.line} FormLabel className uses an expression the guard cannot read`,
      );
    if (added.length) found.push(`${file}:${tag.line} FormLabel adds ${added.join(' ')}`);
  }
  return found;
}

/**
 * Field labels (`label`/`Label` with htmlFor anywhere in the tag) that do not use formLabelClass, or add a
 * size/spacing class next to it. `inlineFor` = htmlFor source text of checkbox labels beside their box.
 */
function fieldLabelOffenders(rel: string, source: string, inlineFor: Set<string>): string[] {
  const ast = parseTsx(rel, source);
  const found: string[] = [];
  for (const tag of jsxTagsNamed(ast, ['label', 'Label'])) {
    const htmlFor = tag.attributes.get('htmlFor');
    if (!htmlFor) continue;
    const target = htmlFor.initializer ? htmlFor.initializer.getText(ast) : '';
    if (inlineFor.has(target)) continue;
    const { added, usesStyleA, readable } = labelClassName(tag.attributes.get('className'), ast);
    if (!usesStyleA) found.push(`${rel}: label htmlFor=${target}`);
    else if (!readable)
      found.push(
        `${rel}: label htmlFor=${target} className uses an expression the guard cannot read`,
      );
    else if (added.length) found.push(`${rel}: label htmlFor=${target} adds ${added.join(' ')}`);
  }
  return found;
}

describe('label style A (R1-4, §4.3)', () => {
  const REPO_ROOT_FROM_UI = '../../../../..';

  it('no FormLabel caller overrides the default label size or spacing', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { resolve, relative } = await import('node:path');
    const root = resolve(__dirname, REPO_ROOT_FROM_UI);
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== 'dist') walk(file, out);
        } else if (/\.tsx?$/.test(entry.name) && !/[.-](test|spec)\.tsx?$/.test(entry.name)) {
          out.push(file);
        }
      }
      return out;
    };
    const files = walk(resolve(root, 'apps/web/src'));
    // Guard against walking the wrong tree and passing vacuously (~1.3k files today).
    expect(files.length).toBeGreaterThan(500);
    const offenders: string[] = [];
    let scanned = 0;
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes('<FormLabel')) continue;
      scanned += 1;
      offenders.push(...formLabelOverrides(relative(root, file).replace(/\\/g, '/'), source));
    }
    expect(scanned).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  }, 30_000);

  const STYLE_A_HOSTS = [
    'apps/web/src/pages/CompanySettingsPage.tsx',
    'apps/web/src/components/customer/CustomerCreateDialog.tsx',
    'apps/web/src/pages/ContractCreatePage/components/CustomerCreateModal.tsx',
    'apps/web/src/components/contract/CustomerEditModal.tsx',
    'apps/web/src/pages/CustomerDetailPage/components/EditCustomerDialog.tsx',
    'apps/web/src/pages/SuppliersPage/components/SupplierForm.tsx',
    'apps/web/src/components/trade-in/QuickBuyModal.tsx',
    // Rendered inside QuickBuyModal step 4 (and TradeInPage AcceptModal).
    'apps/web/src/components/trade-in/SellerPaymentFields.tsx',
    'apps/web/src/pages/BranchesPage.tsx',
    'apps/web/src/components/contacts/CreateContactModal.tsx',
  ];
  // Checkbox labels sit beside their box (inline) — they are not field labels.
  const INLINE_LABEL_FOR = new Set(['"customer-edit-5"', '"ccm-hasvat"']);
  const LEGACY_LABEL_RECIPES = [
    'block text-2xs font-medium text-muted-foreground uppercase tracking-wider',
    'block text-xs font-medium text-foreground mb-1.5',
    'block text-xs text-muted-foreground mb-1',
  ];
  async function readRepoFile(rel: string): Promise<string> {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    return readFileSync(resolve(__dirname, REPO_ROOT_FROM_UI, rel), 'utf8');
  }

  it('every field label in the 9 AddressForm hosts uses formLabelClass', async () => {
    const offenders: string[] = [];
    let fieldLabels = 0;
    for (const rel of STYLE_A_HOSTS) {
      const source = await readRepoFile(rel);
      for (const recipe of LEGACY_LABEL_RECIPES) {
        if (source.includes(recipe)) offenders.push(`${rel}: legacy label "${recipe}"`);
      }
      fieldLabels += jsxTagsNamed(parseTsx(rel, source), ['label', 'Label']).filter((tag) =>
        tag.attributes.has('htmlFor'),
      ).length;
      offenders.push(...fieldLabelOffenders(rel, source, INLINE_LABEL_FOR));
    }
    // the hosts hold ~130 field labels today; a parse that finds none must not pass vacuously
    expect(fieldLabels).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });

  it('label guards read the whole tag and className expressions (synthetic samples)', () => {
    const sample = 'apps/web/src/__guard-sample__.tsx';
    const overrides = (jsx: string) => formLabelOverrides(sample, jsx);
    // className as an expression — the plain-string scan never saw these
    expect(
      overrides('<FormLabel className={cn("text-xs", on && "uppercase")}>ก</FormLabel>'),
    ).toEqual([expect.stringMatching(/__guard-sample__\.tsx:1 FormLabel adds text-xs uppercase$/)]);
    expect(overrides('<FormLabel className={`mb-1 ${extra}`}>ก</FormLabel>')).toEqual([
      expect.stringMatching(/:1 FormLabel adds mb-1$/),
    ]);
    expect(
      overrides('<FormLabel className={on ? "md:text-sm" : "leading-none"}>ก</FormLabel>'),
    ).toEqual([expect.stringMatching(/:1 FormLabel adds md:text-sm leading-none$/)]);
    expect(
      overrides('<FormLabel htmlFor="a"\n  className="text-xs font-medium">ก</FormLabel>'),
    ).toEqual([expect.stringMatching(/:1 FormLabel adds text-xs$/)]);
    expect(overrides('<FormLabel className={styles.label}>ก</FormLabel>')).toEqual([
      expect.stringMatching(/:1 FormLabel className uses an expression the guard cannot read/),
    ]);
    // colour and state classes are not size or spacing
    expect(
      overrides('<FormLabel className={cn("text-destructive", formLabelClass)}>ก</FormLabel>'),
    ).toEqual([]);

    const fields = (jsx: string) => fieldLabelOffenders(sample, jsx, new Set(['"remember"']));
    // htmlFor after other attributes — the old pattern only matched htmlFor as the first attribute
    expect(fields('<Label className="text-xs" htmlFor="name">ชื่อ</Label>')).toEqual([
      `${sample}: label htmlFor="name"`,
    ]);
    expect(
      fields(
        '<label\n  id="road-label"\n  htmlFor={`${id}-road`}\n  className="block text-xs"\n>ถนน</label>',
      ),
    ).toEqual([`${sample}: label htmlFor={\`\${id}-road\`}`]);
    // formLabelClass plus a size or spacing class of its own
    expect(
      fields('<label htmlFor="a" className={cn(formLabelClass, "text-xs")}>ก</label>'),
    ).toEqual([`${sample}: label htmlFor="a" adds text-xs`]);
    expect(fields('<Label className={cn(formLabelClass, "mb-1")} htmlFor="b">ข</Label>')).toEqual([
      `${sample}: label htmlFor="b" adds mb-1`,
    ]);
    expect(
      fields('<label htmlFor="c" className={cn(formLabelClass, labelStyles.x)}>ค</label>'),
    ).toEqual([
      expect.stringMatching(
        /: label htmlFor="c" className uses an expression the guard cannot read/,
      ),
    ]);
    // fine: style A alone or with a colour, an inline checkbox label, a label without htmlFor
    expect(
      fields(
        [
          '<Label className={formLabelClass} htmlFor="d">ง</Label>',
          '<label htmlFor="e" className={cn(formLabelClass, error && "text-destructive")}>จ</label>',
          '<label htmlFor="remember" className="text-sm">จำไว้</label>',
          '<label className="flex gap-2"><input type="checkbox" /> ฉ</label>',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('QuickBuyModal controls no longer carry margins that compensated for inline labels', async () => {
    const modal = await readRepoFile('apps/web/src/components/trade-in/QuickBuyModal.tsx');
    const select = await readRepoFile('apps/web/src/components/trade-in/PurchaseSelect.tsx');
    expect(modal).not.toContain('[&_[data-slot=input]]:mt-2');
    expect(modal).not.toMatch(/className="mt-1(?: font-mono)?"/);
    expect(modal).not.toContain('<div className="mt-2">');
    expect(modal).not.toContain('className="mt-2 flex min-h-16');
    expect(modal).not.toContain('<Label>');
    expect(select).not.toContain('className="mt-2 h-12');
  });
});

// ─── F5 (spec 2026-11-14 §5, Task 12): no non-portalled menu outside the allow-list ───
// Self-contained on purpose: this block re-declares everything it needs under f5*/F5_*
// names, so it does not depend on (or collide with) the helpers above it in this file.
// `describe`/`it`/`expect` are vitest globals (vitest.config.ts `globals: true`).
import * as f5Fs from 'node:fs';
import * as f5Path from 'node:path';
import f5Ts from 'typescript';

const F5_ROOT = f5Path.resolve(__dirname, '../../../../..');
const F5_SCAN_TIMEOUT_MS = 30_000;
const F5_SKIP_DIRS = new Set(['__tests__', 'test', 'tests', 'node_modules', 'dist']);
const F5_TEST_FILE = /[.-](test|spec|docs-spec)\.[jt]sx?$/;
const F5_MENU_ROLES = new Set(['listbox', 'menu']);
const F5_ITEM_ROLES = new Set(['option', 'menuitem', 'listbox', 'menu']);
const F5_INTERACTIVE_TAGS = new Set(['button', 'a', 'input', 'Button', 'CommandItem', 'Link']);
const F5_ITEM_HANDLERS = ['onClick', 'onMouseDown', 'onPointerDown', 'onSelect'];
// Radix content components that render through a Portal (see components/ui: popover, dropdown-menu,
// select, hover-card, context-menu; TooltipContent is portalled by the Radix tooltip primitive).
const F5_PORTAL_TAG = /Portal$|^(Popover|DropdownMenu|Select|HoverCard|ContextMenu|Tooltip)Content$/;
// Full-screen/edge overlays: `inset-0`, `inset-y-*`, `inset-[…]`. NOT `inset-x-*` (a full-width panel).
const F5_OVERLAY_INSET = /^-?inset-(0|y-|\[)/;

/**
 * Files allowed to keep an inline (non-portalled) `absolute` menu, with how many such
 * panels each renders. Exact match both ways: a new menu fails, and so does an entry
 * whose menu was removed or portalled (delete the entry in the same PR).
 * Browser clip checks for the spec's allow-list: tools/field-scale/menu-clip-components.mjs
 */
const F5_NON_PORTAL_MENU_ALLOW: Record<string, { panels: number; reason: string }> = {
  // spec §5 F5 allow-list — each has a case in menu-clip-components.mjs
  'apps/web/src/components/ui/NameAutocomplete.tsx': {
    panels: 1,
    reason: 'allow-list ใน spec §5 F5 — ช่องพิมพ์ชื่ออิสระ ไม่แปลงเป็น Combobox (§6.4)',
  },
  'apps/web/src/pages/PurchaseOrdersPage/components/wizard/items/CatalogPicker.tsx': {
    panels: 1,
    reason: 'allow-list ใน spec §5 F5 — อยู่ในกล่องเลื่อนของหน้าต่างโดยตั้งใจ เลื่อนลงดูผลได้',
  },
  'apps/web/src/pages/UnifiedInboxPage/components/NoteMentionInput.tsx': {
    panels: 1,
    reason: 'allow-list ใน spec §5 F5 — รายชื่อ @แจ้งเตือนเปิดขึ้นเหนือช่องในแผงโน้ต',
  },
  // Found by this scan, NOT in the spec's allow-list, no browser case yet — owner decides portal vs keep.
  'apps/web/src/components/bundle/BundleSearch.tsx': {
    panels: 1,
    reason: 'มีอยู่ก่อนงานนี้ (ค้นของแถม) · นอก allow-list ของ spec — รอเจ้าของตัดสิน',
  },
  'apps/web/src/pages/CollectionsPage/components/InstallmentPickerPopover.tsx': {
    panels: 1,
    reason: 'มีอยู่ก่อนงานนี้ (เลือกงวดที่นัดจ่าย) · นอก allow-list ของ spec — รอเจ้าของตัดสิน',
  },
  'apps/web/src/pages/ExpensesPage.tsx': {
    panels: 1,
    reason: 'มีอยู่ก่อนงานนี้ (เมนู "สร้างเอกสารใหม่") · นอก allow-list ของ spec — รอเจ้าของตัดสิน',
  },
  'apps/web/src/pages/POSPage/components/CustomerSearch.tsx': {
    panels: 1,
    reason: 'มีอยู่ก่อนงานนี้ (ค้นลูกค้าหน้า POS) · นอก allow-list ของ spec — รอเจ้าของตัดสิน',
  },
  'apps/web/src/pages/settings/SettingsLayout.tsx': {
    panels: 1,
    reason: 'มีอยู่ก่อนงานนี้ (ผลค้นหาการตั้งค่า) · นอก allow-list ของ spec — รอเจ้าของตัดสิน',
  },
  'apps/web/src/pages/UnifiedInboxPage/components/SessionActions.tsx': {
    panels: 2,
    reason: 'มีอยู่ก่อนงานนี้ (เมนู "โอนให้พนักงาน" + "สร้างสัญญา") · นอก allow-list ของ spec — รอเจ้าของตัดสิน',
  },
};

function f5ListTsx(dir: string, out: string[] = []): string[] {
  for (const entry of f5Fs.readdirSync(dir, { withFileTypes: true })) {
    const file = f5Path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (!F5_SKIP_DIRS.has(entry.name)) f5ListTsx(file, out);
    } else if (entry.name.endsWith('.tsx') && !F5_TEST_FILE.test(entry.name)) {
      out.push(file);
    }
  }
  return out;
}

/**
 * 1-based lines of every inline menu panel in a .tsx source. A panel is a JSX element
 * whose className has `absolute` (any variant, resolving same-file `const` strings) and
 * no overlay inset (`inset-0`, `inset-y-*`, `inset-[…]`; `inset-x-*` is a full-width panel
 * and still counts), that
 *   (a) is placed against a trigger — `top-full` / `bottom-full` / `mt-*` / `mb-*`, a
 *       `style` with `top`/`bottom`, or role listbox/menu;
 *   (b) holds items — role listbox/menu, or a descendant button/a/input/Button/Link/
 *       CommandItem, role option/menuitem, or onClick/onMouseDown/onPointerDown/onSelect;
 *   (c) is rendered on demand — walking up through parentheses, fragments, wrapper
 *       elements and `{…}` children, the nearest condition is the right side of `&&`, a
 *       branch of `?:`, or the `return` after an `if (…) return null`;
 *   (d) is not inside *Portal / Popover|DropdownMenu|Select|HoverCard|ContextMenu|Tooltip
 *       Content / createPortal().
 * Icons and clear buttons fail (a)/(c), badges and tooltips fail (b), image overlays and
 * drawers use `inset-*`, and Radix/cmdk menus are portalled (d).
 *
 * Known limits (a static scan, not a layout engine):
 *  - placement is recognised only by top-full, bottom-full, mt-N, mb-N, style top|bottom or a role;
 *    a panel placed only with `top-N` / `right-N` classes is not seen;
 *  - panels that are always rendered and shown with CSS (`hidden group-hover:block`,
 *    `peer-focus:block`) are not "rendered on demand" and are not seen;
 *  - a panel stored in a variable (`const panel = <div …/>`) and rendered as `{panel}`;
 *  - class names built with clsx object syntax (`clsx({ absolute: open })`), and `style`
 *    passed as a variable instead of an object literal;
 *  - the allow-list counts panels per file: swapping one allow-listed panel for another in
 *    the same file keeps the count and passes.
 */
function findInlineMenuPanels(fileName: string, source: string): number[] {
  const ast = f5Ts.createSourceFile(fileName, source, f5Ts.ScriptTarget.Latest, true, f5Ts.ScriptKind.TSX);
  const consts = new Map<string, f5Ts.Expression>();
  const collect = (node: f5Ts.Node): void => {
    if (f5Ts.isVariableDeclaration(node) && f5Ts.isIdentifier(node.name) && node.initializer) {
      consts.set(node.name.text, node.initializer);
    }
    f5Ts.forEachChild(node, collect);
  };
  collect(ast);

  const strings = (node: f5Ts.Node, out: string[], seen: Set<string>): string[] => {
    if (f5Ts.isIdentifier(node)) {
      const init = consts.get(node.text);
      if (init && !seen.has(node.text)) {
        seen.add(node.text);
        strings(init, out, seen);
      }
    } else if (f5Ts.isStringLiteral(node) || f5Ts.isNoSubstitutionTemplateLiteral(node)) {
      out.push(node.text);
    } else if (f5Ts.isTemplateExpression(node)) {
      out.push(node.head.text);
      for (const span of node.templateSpans) {
        strings(span.expression, out, seen);
        out.push(span.literal.text);
      }
    } else {
      // forEachChild stops at the first truthy return value — keep this callback void.
      f5Ts.forEachChild(node, (child) => {
        strings(child, out, seen);
      });
    }
    return out;
  };

  type Opening = f5Ts.JsxOpeningElement | f5Ts.JsxSelfClosingElement;
  const attr = (el: Opening, name: string) =>
    el.attributes.properties.find(
      (a): a is f5Ts.JsxAttribute => f5Ts.isJsxAttribute(a) && a.name.getText(ast) === name,
    );
  const roleOf = (el: Opening): string => {
    const init = attr(el, 'role')?.initializer;
    return init && f5Ts.isStringLiteral(init) ? init.text : '';
  };
  const classTokens = (el: Opening): string[] => {
    const init = attr(el, 'className')?.initializer;
    if (!init) return [];
    return strings(init, [], new Set())
      .join(' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => token.split(':').pop() ?? token);
  };
  const styleSetsTopOrBottom = (el: Opening): boolean => {
    const init = attr(el, 'style')?.initializer;
    const expr = init && f5Ts.isJsxExpression(init) ? init.expression : undefined;
    return (
      !!expr &&
      f5Ts.isObjectLiteralExpression(expr) &&
      expr.properties.some((p) => !!p.name && ['top', 'bottom'].includes(p.name.getText(ast)))
    );
  };
  const renderedOnDemand = (el: f5Ts.Node): boolean => {
    // Walk up through wrappers (parentheses, fragments, elements, `{…}` children) to the nearest
    // condition, so `{open && (<><backdrop/><div className="absolute …"/></>)}` still counts.
    let node = el;
    for (;;) {
      const parent = node.parent;
      if (!parent) return false;
      if (
        f5Ts.isParenthesizedExpression(parent) ||
        f5Ts.isJsxFragment(parent) ||
        f5Ts.isJsxElement(parent) ||
        f5Ts.isJsxExpression(parent)
      ) {
        node = parent;
        continue;
      }
      if (f5Ts.isBinaryExpression(parent)) {
        return parent.operatorToken.kind === f5Ts.SyntaxKind.AmpersandAmpersandToken && parent.right === node;
      }
      if (f5Ts.isConditionalExpression(parent)) return parent.whenTrue === node || parent.whenFalse === node;
      if (f5Ts.isReturnStatement(parent) && f5Ts.isBlock(parent.parent)) {
        const body = parent.parent.statements;
        return body
          .slice(0, body.indexOf(parent))
          .some((s) => f5Ts.isIfStatement(s) && /\breturn\s+null\b/.test(s.thenStatement.getText(ast)));
      }
      return false;
    }
  };
  const insidePortal = (el: f5Ts.Node): boolean => {
    for (let node: f5Ts.Node | undefined = el.parent; node; node = node.parent) {
      if (f5Ts.isJsxElement(node) && F5_PORTAL_TAG.test(node.openingElement.tagName.getText(ast))) return true;
      if (f5Ts.isCallExpression(node) && /createPortal$/.test(node.expression.getText(ast))) return true;
    }
    return false;
  };
  const holdsItems = (el: f5Ts.JsxElement): boolean => {
    let found = false;
    const visit = (node: f5Ts.Node): void => {
      if (found) return;
      if (
        (f5Ts.isJsxOpeningElement(node) || f5Ts.isJsxSelfClosingElement(node)) &&
        (F5_INTERACTIVE_TAGS.has(node.tagName.getText(ast)) ||
          F5_ITEM_ROLES.has(roleOf(node)) ||
          F5_ITEM_HANDLERS.some((handler) => !!attr(node, handler)))
      ) {
        found = true;
        return;
      }
      f5Ts.forEachChild(node, visit);
    };
    el.children.forEach(visit);
    return found;
  };

  const lines: number[] = [];
  const visit = (node: f5Ts.Node): void => {
    if (f5Ts.isJsxElement(node) || f5Ts.isJsxSelfClosingElement(node)) {
      const opening = f5Ts.isJsxElement(node) ? node.openingElement : node;
      const tokens = classTokens(opening);
      if (tokens.includes('absolute') && !tokens.some((t) => F5_OVERLAY_INSET.test(t))) {
        const menuRole = F5_MENU_ROLES.has(roleOf(opening));
        const placed =
          menuRole ||
          styleSetsTopOrBottom(opening) ||
          tokens.some((t) => t === 'top-full' || t === 'bottom-full' || /^-?m[tb]-/.test(t));
        const items = menuRole || (f5Ts.isJsxElement(node) && holdsItems(node));
        if (placed && items && renderedOnDemand(node) && !insidePortal(node)) {
          lines.push(ast.getLineAndCharacterOfPosition(opening.getStart(ast)).line + 1);
        }
      }
    }
    f5Ts.forEachChild(node, visit);
  };
  visit(ast);
  return lines;
}

const F5_POSITIVE: [string, string][] = [
  [
    'listbox via cn() + same-file const (inline input + listbox)',
    `export function A({ open, up }: { open: boolean; up: boolean }) {
      const menuPos = up ? 'bottom-full mb-1' : 'mt-1';
      return <div className="relative"><input role="combobox" aria-expanded={open} />
        {open && (<div role="listbox" className={cn('absolute z-50 w-full', menuPos)}><button role="option">ก</button></div>)}
      </div>;
    }`,
  ],
  [
    'early return null (InstallmentPickerPopover)',
    `export function B({ open }: { open: boolean }) {
      if (!open) return null;
      return (<div className="absolute z-50 mt-1 w-full rounded-xl border bg-card shadow-lg"><button type="button">งวด 1</button></div>);
    }`,
  ],
  [
    'AccountSearchDropdown panel as of HEAD 2026-11-14 (Task 6 replaces it with PopoverContent)',
    `export function C({ open, disabled }: { open: boolean; disabled: boolean }) {
      return <div className="relative"><button data-slot="select-trigger" type="button">เลือก</button>
        {open && !disabled && (
          <div className="absolute z-30 w-full mt-1 rounded-md border shadow-lg bg-popover" style={{ maxHeight: 320 }}>
            <input aria-label="ค้นหา" /><button type="button">42-1102</button>
          </div>
        )}</div>;
    }`,
  ],
  [
    'role=menu in a ternary, template-literal className',
    'export function D({ show }: { show: boolean }) { return show ? (<div role="menu" className={`absolute left-0 top-full mt-1 ${show ? "block" : ""}`}><span>รายการ</span></div>) : null; }',
  ],
  [
    'caret-positioned autocomplete (style top/left)',
    `export function E({ show, pos }: { show: boolean; pos: { top: number; left: number } }) {
      return <div className="relative"><textarea />{show && (<div className="absolute z-50 w-80 bg-card shadow-xl" style={{ top: pos.top + 30, left: pos.left }}><button type="button">ตัวแปร</button></div>)}</div>;
    }`,
  ],
  [
    'fragment with a fixed inset-0 backdrop beside the panel',
    `export function F({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
      return <div className="relative">{open && (<><div className="fixed inset-0" onClick={() => setOpen(false)} />
        <div className="absolute right-0 mt-2 w-56 rounded-md border bg-card shadow-lg"><button type="button">ลบ</button></div></>)}</div>;
    }`,
  ],
  [
    'panel inside a wrapper div that is under the condition',
    `export function G({ open }: { open: boolean }) {
      return <div className="relative">{open && (<div className="contents"><section><div className="absolute left-0 top-full mt-1"><button type="button">ก</button></div></section></div>)}</div>;
    }`,
  ],
  [
    'full-width panel with inset-x-0 top-full',
    `export function H({ open }: { open: boolean }) {
      return <div className="relative">{open && <div className="absolute inset-x-0 top-full z-20 border bg-card"><button type="button">ก</button></div>}</div>;
    }`,
  ],
  [
    'react-router <Link> items',
    `export function I({ open }: { open: boolean }) {
      return <div className="relative">{open && <div className="absolute right-0 mt-2 border bg-card"><Link to="/a">ก</Link></div>}</div>;
    }`,
  ],
  [
    'onSelect item',
    `export function J({ open }: { open: boolean }) {
      return <div className="relative">{open && <div className="absolute right-0 mt-2 border bg-card"><div onSelect={() => {}}>ก</div></div>}</div>;
    }`,
  ],
  [
    'onPointerDown item',
    `export function K({ open }: { open: boolean }) {
      return <div className="relative">{open && <div className="absolute right-0 mt-2 border bg-card"><li onPointerDown={() => {}}>ก</li></div>}</div>;
    }`,
  ],
  [
    'ternary panel inside a .map item',
    `export function L({ rows, sel }: { rows: string[]; sel: string }) {
      return <ul>{rows.map((r) => (<li key={r} className="relative">{r}{sel === r ? (<div className="absolute right-0 mt-1 border bg-card"><button type="button">ก</button></div>) : null}</li>))}</ul>;
    }`,
  ],
];

const F5_NEGATIVE: [string, string][] = [
  ['leading icon', '<div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" /><input /></div>'],
  ['count badge', '<div className="relative">{count > 0 && <span className="absolute -top-1 -right-1 rounded-full bg-destructive">{count}</span>}</div>'],
  ['hover tooltip', '<div className="relative">{hover && <div className="absolute bottom-full mb-2 rounded bg-popover px-2 text-xs shadow">คำอธิบาย</div>}</div>'],
  ['clear button', '<div className="relative">{query && (<button type="button" className="absolute right-2 top-1/2 -translate-y-1/2"><X className="size-4" /></button>)}</div>'],
  ['image overlay', '<div className="relative">{hover && (<div className="absolute inset-0 flex bg-background/80"><button type="button">ลบรูป</button></div>)}</div>'],
  [
    'positioned wrapper of a Radix DropdownMenu (BookingDetailSheet)',
    '<div>{showMenu && (<div className="absolute right-14 top-2"><DropdownMenu><DropdownMenuTrigger asChild><Button aria-label="เพิ่มเติม" /></DropdownMenuTrigger></DropdownMenu></div>)}</div>',
  ],
  [
    'AccountSearchDropdown after Task 6 (PopoverContent portal)',
    `<Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button type="button" role="combobox">เลือกบัญชี</button></PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0">
        <Search className="absolute left-2 top-2.5 size-3.5" />
        {open && (<div className="absolute mt-1 w-full"><button type="button">42-1102</button></div>)}
      </PopoverContent>
    </Popover>`,
  ],
  [
    'inset-y-0 side drawer',
    '<div>{open && (<div className="absolute inset-y-0 right-0 mt-0 w-80"><button type="button">ปิด</button></div>)}</div>',
  ],
  [
    'inset-[…] overlay',
    '<div>{open && (<div className="absolute inset-[2px] mt-1"><button type="button">ปิด</button></div>)}</div>',
  ],
  [
    'Radix SelectContent portal',
    '<Select>{open && (<SelectContent><div className="absolute mt-1"><button type="button">ก</button></div></SelectContent>)}</Select>',
  ],
  [
    'Radix HoverCardContent portal',
    '<HoverCard>{open && (<HoverCardContent><div className="absolute mt-1"><button type="button">ก</button></div></HoverCardContent>)}</HoverCard>',
  ],
  [
    'Radix TooltipContent portal',
    '<Tooltip>{open && (<TooltipContent><div className="absolute mt-1"><button type="button">ก</button></div></TooltipContent>)}</Tooltip>',
  ],
];

describe('F5 — inline (non-portalled) menus (spec 2026-11-14 §5)', () => {
  it.each(F5_POSITIVE)('detector flags: %s', (_label, source) => {
    expect(findInlineMenuPanels('fixture.tsx', source)).toHaveLength(1);
  });

  it.each(F5_NEGATIVE)('detector ignores: %s', (_label, source) => {
    expect(findInlineMenuPanels('fixture.tsx', source)).toEqual([]);
  });

  it('every allow-list entry says why it may stay', () => {
    const weak = Object.entries(F5_NON_PORTAL_MENU_ALLOW)
      .filter(([, { panels, reason }]) => panels < 1 || reason.trim().length < 10)
      .map(([file]) => file);
    expect(weak).toEqual([]);
  });

  it(
    'only allow-listed files render an absolute menu outside a portal',
    () => {
      const files = f5ListTsx(f5Path.resolve(F5_ROOT, 'apps/web/src'));
      // Guard against the scan silently walking the wrong tree and passing vacuously.
      expect(files.length).toBeGreaterThan(500);
      const found: Record<string, number> = {};
      for (const file of files) {
        const source = f5Fs.readFileSync(file, 'utf8');
        if (!/\babsolute\b/.test(source)) continue;
        const panels = findInlineMenuPanels(file, source);
        if (panels.length) found[f5Path.relative(F5_ROOT, file).split(f5Path.sep).join('/')] = panels.length;
      }
      const allowed = Object.fromEntries(
        Object.entries(F5_NON_PORTAL_MENU_ALLOW).map(([file, { panels }]) => [file, panels]),
      );
      expect(found).toEqual(allowed);
    },
    F5_SCAN_TIMEOUT_MS,
  );
});

// Combobox sizing guard. admin-typography.css sets an unlayered `max-width:100%` and `height` on
// `button[role=combobox]`, so a w-/max-w-/min-w-/h- utility in the trigger `className` does nothing
// (and a narrow trigger would leave the clear button outside the field). Size it with `wrapperClassName`.
const COMBOBOX_SIZE_TOKEN = /^(?:w|max-w|min-w|h)-\S/;

// Tags whose `className` reaches the shared `Combobox` trigger: `Combobox` itself and the wrappers that
// forward it (`<Combobox ... className={className} />`, checked in each file). `EmployeeCombobox` takes no
// `className`; `VendorCombobox` / `RepairCenterCombobox` hand theirs to `ContactCombobox`.
const COMBOBOX_TAGS = new Set<string>(['Combobox', 'AccountCombobox', 'ContactCombobox', 'CustomerCombobox']);

function comboboxSizeViolations(file: string, source: string): string[] {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const where = relative(ROOT, file).split(sep).join('/');
  const found: string[] = [];
  const inspect = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      COMBOBOX_TAGS.has(node.tagName.getText(ast))
    ) {
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText(ast) !== 'className') continue;
        if (!attribute.initializer) continue;
        const collected: ClassCollection = { strings: [], unreadable: [] };
        collectClassStrings(attribute.initializer, ast, collected);
        const line = ast.getLineAndCharacterOfPosition(attribute.getStart(ast)).line + 1;
        for (const item of collected.unreadable) {
          found.push(`${where}:${line} Combobox className uses an expression the guard cannot read (${item.kind})`);
        }
        const sizing = collected.strings
          .flatMap((text) => text.split(/\s+/))
          .filter((token) => token && COMBOBOX_SIZE_TOKEN.test(stripVariants(token).replace(/^!/, '').replace(/!$/, '')));
        if (sizing.length) {
          found.push(`${where}:${line} ${sizing.join(' ')} — move it to wrapperClassName`);
        }
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(ast);
  return found;
}

describe('Combobox sizing guard', () => {
  it('flags width/height utilities in a Combobox className in every spelling', () => {
    const sample = resolve(ROOT, 'apps/web/src/__guard-sample__.tsx');
    const run = (className: string) => comboboxSizeViolations(sample, `<Combobox className=${className} />`);
    expect(run('"max-w-[130px]"')).toHaveLength(1);
    expect(run('"sm:w-56"')).toHaveLength(1);
    expect(run('{cn("font-mono", ok && "h-9")}')).toHaveLength(1);
    expect(run('"font-mono text-right"')).toEqual([]);
    expect(comboboxSizeViolations(sample, '<Combobox wrapperClassName="max-w-[130px]" />')).toEqual([]);
    expect(comboboxSizeViolations(sample, '<AccountCombobox className="w-40" />')).toHaveLength(1);
    expect(comboboxSizeViolations(sample, '<AccountCombobox wrapperClassName="w-40" />')).toEqual([]);
  });

  it(
    'no production <Combobox> sets width, max-width, min-width or height in its className',
    () => {
      const found = listSourceFiles(WEB_SRC)
        .map((file) => ({ file, source: readFileSync(file, 'utf8') }))
        .filter(({ source }) => /<(?:Combobox|AccountCombobox|ContactCombobox|CustomerCombobox)\b/.test(source))
        .flatMap(({ file, source }) => comboboxSizeViolations(file, source));
      expect(found).toEqual([]);
    },
    SCAN_TIMEOUT_MS,
  );
});
