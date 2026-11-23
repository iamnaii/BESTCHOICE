import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, parseFragment } from 'parse5';
import postcss from 'postcss';
import ts from 'typescript';

const apps = ['apps/web', 'apps/web-shop'];
const sourceRoots = [...apps.map((app) => `${app}/src`), 'packages/icons/src'];
const centralPhosphor = new Set([
  'packages/icons/src/index.ts',
  'packages/icons/src/create-icon.ts',
  'apps/web/src/config/navigation-icons.ts',
]);
const historicalHtml = new Set([
  'apps/web/public/design-preview-flex-messages.html',
  'apps/web/public/design-preview-liff-contract.html',
  'apps/web/public/design-preview-liff-early-payoff.html',
  'apps/web/public/design-preview-liff-history.html',
  'apps/web/public/design-preview-liff-profile.html',
]);

const forbiddenKinds = new Set(['legacy-import', 'direct-phosphor']);
const candidateKinds = new Set(['inline-svg', 'unicode-symbol', 'image-or-css-icon']);
const categories = new Set(['brand', 'content', 'graphic', 'reference', 'external-native']);
const generated = new Set(['dist', 'node_modules', 'coverage']);
const fixturePath =
  /(?:^|\/)(?:__tests__|__fixtures__|__mocks__|__snapshots__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const scriptFile = /\.[cm]?[jt]sx?$/;
const legacyLibrary =
  /^(?:lucide(?:-react|-static|-angular|-vue-next)?|react-icons|@heroicons\/react|heroicons|phosphor-react|@fortawesome\/(?:react-fontawesome|fontawesome-free|(?:free|pro)-[\w-]+-svg-icons)|@tabler\/icons-react|@mdi\/(?:js|react)|@mui\/icons-material|@ant-design\/icons|@iconify\/react|@radix-ui\/react-icons)(?:\/|@|$)/;
const phosphorLibrary = /^@phosphor-icons\/react(?:\/|@|$)/;
const pictograph =
  /[\p{Extended_Pictographic}\u2190-\u21ff\u27f0-\u27ff\u2900-\u297f✓✔✕✖✗✘★☆●○◉◌◦▪▫■□☑☐☒▲△▼▽▶▷◀◁⊕⊖☰⋯×♪]/u;
const asciiGlyph = /^(?:[!+?<>]|<{2}|>{2})$/;
const ambiguousGlyph = /^(?:[−–—\-xX]|\.{3}|…)$/;
const asciiCaption = /(?:^|\s)\([+−-]\)$/;
const imageExtension = /\.(?:svg|ico|png|apng|webp|avif|gif|jpe?g)(?:[?#][^\s"'<>]*)?$/i;
const imageData = /^data:image\/[\w.+-]+[;,]/i;
const generatedContent = /(?:^|[:\s])(?:before:|after:)?content-\[(?!['"]{2}\])[^\]]+\]/;
const visibleHtmlAttributes = new Set([
  'alt',
  'aria-label',
  'aria-description',
  'title',
  'placeholder',
  'value',
]);
const iconLinkRels = new Set([
  'icon',
  'apple-touch-icon',
  'apple-touch-icon-precomposed',
  'mask-icon',
]);

function normalize(value) {
  return value.trim().replace(/\s+/g, ' ');
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function compactSyntax(value) {
  const syntax = normalize(value);
  return syntax.length <= 240 ? syntax : `${syntax.slice(0, 160)}… sha256:${digest(syntax)}`;
}

function decodeEntities(value) {
  return value.replace(/&(?:#\d+|#x[0-9a-f]+|[a-z][a-z\d]+);/gi, (entity) => {
    return parseFragment(entity).childNodes[0]?.value ?? entity;
  });
}

function hasGlyph(value, includeAscii, includeAmbiguous = false) {
  const text = normalize(value);
  // Extended_Pictographic includes copyright and trademark marks. Inline legal
  // notation is ordinary prose, while a standalone mark can still be a glyph.
  const symbols = includeAmbiguous ? text : text.replace(/[©®™]/g, '');
  return (
    pictograph.test(symbols) ||
    (includeAscii && (asciiGlyph.test(text) || asciiCaption.test(text))) ||
    (includeAmbiguous && ambiguousGlyph.test(text))
  );
}

function imageReference(value) {
  return (
    imageData.test(value) ||
    (!/[\s"'<>]/.test(value) && !value.startsWith('.') && imageExtension.test(value)) ||
    (/^\.\.?\//.test(value) && imageExtension.test(value))
  );
}

function imageUrlInStyle(value) {
  const urls = value.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)\s]+))\s*\)/gi);
  return [...urls].some(([, doubleQuoted, singleQuoted, unquoted]) =>
    imageReference(doubleQuoted ?? singleQuoted ?? unquoted),
  );
}

function assetStyle(value) {
  return (
    imageUrlInStyle(value) ||
    generatedContent.test(value) ||
    /\[(?:-webkit-)?mask(?:-image)?:/i.test(value)
  );
}

function progressClass(classes, inlineStyle = '') {
  return (
    /\banimate-spin\b/.test(classes) &&
    /(?:\bborder-\w|\bconic-gradient|\bbg-conic)/.test(`${classes} ${inlineStyle}`)
  );
}

function sourceContext(node, file) {
  const parents = [];
  let jsxOwners = 0;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      ts.isVariableDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent)
    ) {
      if (parent.name) parents.push(compactSyntax(parent.name.getText(file)));
    } else if (ts.isJsxElement(parent)) {
      const opening = parent.openingElement;
      parents.push(
        jsxOwners++ < 2 ? compactSyntax(opening.getText(file)) : opening.tagName.getText(file),
      );
    } else if (ts.isJsxSelfClosingElement(parent)) {
      jsxOwners++;
      parents.push(compactSyntax(parent.getText(file)));
    } else if (ts.isJsxAttribute(parent)) {
      parents.push(`@${parent.name.getText(file)}`);
    } else if (ts.isCallExpression(parent)) {
      parents.push(`call ${compactSyntax(parent.expression.getText(file))}`);
    } else if (ts.isObjectLiteralExpression(parent) && ts.isArrayLiteralExpression(parent.parent)) {
      const label = parent.properties.find(
        (property) =>
          ts.isPropertyAssignment(property) &&
          /^(?:id|key|label|name|title|category)$/.test(property.name.getText(file)) &&
          ts.isStringLiteralLike(property.initializer),
      );
      if (label && label !== node && label.initializer !== node) {
        parents.push(compactSyntax(label.getText(file)));
      }
    }
  }
  return [...parents.reverse(), compactSyntax(node.getText(file))].join(' > ');
}

function moduleSpecifier(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  if (ts.isExternalModuleReference(node)) return node.expression;
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
    return node.argument.literal;
  if (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
  ) {
    return node.arguments[0];
  }
}

function importKind(module, path) {
  const [specifier] = module.replace(/^https?:\/\/[^/]+\/(?:npm\/)?/, '').split(/[?#]/, 1);
  if (legacyLibrary.test(specifier)) return 'legacy-import';
  if (phosphorLibrary.test(specifier) && !centralPhosphor.has(path)) return 'direct-phosphor';
}

function renderContext(node) {
  let visible = false;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxAttribute(parent)) {
      const name = parent.name.getText();
      return { visible: visible || visibleHtmlAttributes.has(name) || name === 'label' };
    }
    if (ts.isJsxElement(parent)) {
      const opening = parent.openingElement;
      const tag = opening.tagName.getText();
      const attributes = opening.attributes.getText();
      if (tag === 'style' || tag === 'script') return { code: true };
      if (isAffordance(tag, attributes)) return { visible: true, affordance: true };
      visible = true;
      continue;
    }
    if (ts.isCallExpression(parent) || ts.isStatement(parent)) break;
    if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) {
      if (visible) break;
      const name = parent.name.getText();
      const affordance = /(?:icons?|glyphs?|symbols?|keycaps?|chevron|mark|badge)$/i.test(name);
      return { visible: affordance || /(?:labels?|initials?$|^keys$)/i.test(name), affordance };
    }
  }
  return { visible };
}

function isAffordance(tag, attributes) {
  const fixedSize =
    /\bsize-/.test(attributes) || (/\bh-/.test(attributes) && /\bw-/.test(attributes));
  const centeredCircle =
    fixedSize &&
    /\brounded-full\b/.test(attributes) &&
    /\bitems-center\b/.test(attributes) &&
    /\bjustify-center\b/.test(attributes);
  return (
    /^(?:a|kbd|button|\w*Button|\w*Link|\w*Trigger)$/.test(tag) ||
    /\bonClick\b|\brole\s*=\s*["'](?:button|alert|status)["']/i.test(attributes) ||
    centeredCircle
  );
}

// Look up direct const declarations within the JSX's enclosing blocks and source file.
function localStringConstant(expression) {
  const { text: name } = expression;
  for (let scope = expression.parent; scope; scope = scope.parent) {
    if (
      ts.isFunctionLike(scope) &&
      scope.parameters.some(
        (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name,
      )
    )
      return;
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      const list = statement.declarationList;
      const declaration = list.declarations.find(
        (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name,
      );
      if (!declaration) continue;
      if (
        list.flags & ts.NodeFlags.Const &&
        declaration.initializer &&
        ts.isStringLiteralLike(declaration.initializer)
      ) {
        return declaration.initializer;
      }
      return;
    }
  }
}

function isImageSource(tag, attribute) {
  const name = attribute.toLowerCase();
  return (
    (name === 'src' && (tag === 'img' || tag === 'image')) ||
    (name === 'srcset' && (tag === 'img' || tag === 'source'))
  );
}

function isJsxImageSource(node, file) {
  const owner = ts.isJsxExpression(node.parent) ? node.parent.parent : node.parent;
  return (
    ts.isJsxAttribute(owner) &&
    isImageSource(owner.parent.parent.tagName.getText(file), owner.name.getText(file))
  );
}

function textOf(node) {
  if (ts.isJsxText(node) || ts.isJsxAttribute(node.parent)) return decodeEntities(node.text);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map(({ literal }) => literal.text)].join(
      '\ufffc',
    );
  }
}

function scanScript(source, path, add, { importsOnly = false, htmlContext = '' } = {}) {
  const file = ts.createSourceFile(
    htmlContext ? 'inline-script.js' : path,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const groupedLiterals = new WeakSet();

  function visit(node, inspectCandidates) {
    const emit = (kind) => add(kind, htmlContext + sourceContext(node, file));
    const module = moduleSpecifier(node);
    if (module && ts.isStringLiteralLike(module)) {
      const kind = importKind(module.text, path);
      if (kind) emit(kind);
    }
    if (inspectCandidates) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      if (
        (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) &&
        opening.tagName.getText(file) === 'svg'
      ) {
        emit('inline-svg');
        ts.forEachChild(node, (child) => visit(child, false));
        return;
      }
      if (ts.isArrayLiteralExpression(node) && node.elements.every(ts.isStringLiteralLike)) {
        const glyphs = node.elements.filter(({ text }) => hasGlyph(text, false));
        if (glyphs.length > 1) {
          emit('unicode-symbol');
          for (const glyph of glyphs) groupedLiterals.add(glyph);
        }
      }
      if (ts.isJsxAttribute(node) && node.name.getText(file) === 'className') {
        const value = node.initializer?.getText(file) ?? '';
        const opening = node.parent.parent;
        const style = node.parent.properties.find(
          (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'style',
        );
        if (
          assetStyle(value) ||
          (/^[a-z][\w-]*$/.test(opening.tagName.getText(file)) &&
            progressClass(value, style?.getText(file)))
        ) {
          emit('image-or-css-icon');
        }
      }
      if (ts.isJsxExpression(node) && node.expression && ts.isIdentifier(node.expression)) {
        const context = renderContext(node);
        if (context.visible) {
          const literal = localStringConstant(node.expression);
          if (literal && hasGlyph(literal.text, true, context.affordance)) {
            const declaration = renderContext(literal);
            if (!hasGlyph(literal.text, declaration.visible, declaration.affordance)) {
              add(
                'unicode-symbol',
                `${htmlContext}${sourceContext(node, file)} = ${compactSyntax(literal.getText(file))}`,
              );
            }
          }
        }
      }
      if (ts.isJsxText(node) || ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
        const value = textOf(node);
        const { visible, affordance, code } = renderContext(node);
        if (!code) {
          const attribute = ts.isJsxAttribute(node.parent)
            ? node.parent.name.getText(file)
            : undefined;
          if (attribute !== 'className') {
            if (!groupedLiterals.has(node) && hasGlyph(value, visible, affordance)) {
              emit('unicode-symbol');
            }
            // An asset reference can occur in JSX, a CSS-in-JS property, or a static data constant.
            if (
              imageReference(value) ||
              imageUrlInStyle(value) ||
              (value.trim() && ts.isStringLiteralLike(node) && isJsxImageSource(node, file))
            ) {
              emit('image-or-css-icon');
            }
            if (/<svg[\s>]/i.test(value) && /<\/svg>/i.test(value)) emit('inline-svg');
          }
        } else if (!ts.isTemplateExpression(node)) {
          const container = ts.isJsxExpression(node.parent) ? node.parent.parent : node.parent;
          if (
            ts.isJsxElement(container) &&
            container.openingElement.tagName.getText(file) === 'style'
          ) {
            scanCss(value, path, add, `${htmlContext}${sourceContext(container, file)} > `);
          }
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, inspectCandidates));
  }

  visit(file, !importsOnly);
}

function cssAsset(declaration) {
  const { prop, value } = declaration;
  if (/^(?:-webkit-)?mask(?:-image)?$/i.test(prop) && value !== 'none') return true;
  if (imageUrlInStyle(value)) return true;
  return prop.toLowerCase() === 'content' && !/^(?:none|normal|'\s*'|"\s*")$/i.test(value.trim());
}

function scanCss(source, path, add, context = '') {
  const sheet = postcss.parse(source, { from: path });
  sheet.walkDecls((declaration) => {
    if (!cssAsset(declaration)) return;
    const selector = declaration.parent.selector || declaration.parent.name || '';
    add('image-or-css-icon', `${context}${selector} > ${normalize(declaration.toString())}`.trim());
  });
  sheet.walkRules((rule) => {
    const declarations = rule.nodes.filter((node) => node.type === 'decl');
    const rotates = declarations.some(
      ({ prop, value }) => /^animation(?:-name)?$/i.test(prop) && /(?:spin|rotat)/i.test(value),
    );
    const ring = declarations.some(
      ({ prop, value }) =>
        /^border-.*(?:color|width)$/i.test(prop) ||
        /^border-(?:top|right|bottom|left|block-(?:start|end)|inline-(?:start|end))(?:-style)?$/i.test(
          prop,
        ) ||
        /conic-gradient/i.test(value),
    );
    if (rotates && ring) add('image-or-css-icon', `${context}${compactSyntax(rule.toString())}`);
  });
}

function scanHtml(source, path, add) {
  const historical = historicalHtml.has(path);
  if (historical) add('inline-svg', `Historical HTML sha256:${digest(source)}`);

  function visit(node, parents, affordance = false) {
    const tag = node.tagName;
    const where = parents.join(' > ');
    const attrs = Object.fromEntries((node.attrs ?? []).map(({ name, value }) => [name, value]));
    const location = node.sourceCodeLocation;
    const opening =
      location?.startTag &&
      compactSyntax(source.slice(location.startTag.startOffset, location.startTag.endOffset));
    const context = opening ? [where, opening].filter(Boolean).join(' > ') : where;

    if (tag === 'script') {
      if (attrs.src) {
        const kind = importKind(attrs.src, path);
        if (kind) add(kind, context);
      } else if (
        !attrs.type ||
        /^(?:module|(?:text|application)\/(?:java|ecma)script)$/i.test(attrs.type)
      ) {
        const code = node.childNodes.map(({ value }) => value).join('');
        scanScript(code, path, add, { importsOnly: historical, htmlContext: `${context} > ` });
      }
      return;
    }

    if (!historical) {
      if (node.nodeName === '#text' && location && hasGlyph(node.value, true, affordance)) {
        add(
          'unicode-symbol',
          `${where} > ${compactSyntax(source.slice(location.startOffset, location.endOffset))}`,
        );
      }
      if (tag === 'style') {
        scanCss(node.childNodes.map(({ value }) => value).join(''), path, add, `${context} > `);
        return;
      }
      if (tag === 'svg' && location) {
        add(
          'inline-svg',
          `${where} > ${compactSyntax(source.slice(location.startOffset, location.endOffset))}`,
        );
        return;
      }
      for (const [name, value] of Object.entries(attrs)) {
        if (
          visibleHtmlAttributes.has(name) &&
          hasGlyph(value, true, isAffordance(tag, opening ?? ''))
        ) {
          add('unicode-symbol', `${context} > @${name}`);
        }
        if (
          isImageSource(tag, name) ||
          (name === 'href' && tag === 'link' && iconLinkRels.has(attrs.rel?.toLowerCase()))
        ) {
          add('image-or-css-icon', `${context} > @${name}`);
        }
      }
      if (attrs.style) scanCss(attrs.style, path, add, `${context} > @style > `);
      if (attrs.class && (assetStyle(attrs.class) || progressClass(attrs.class, attrs.style))) {
        add('image-or-css-icon', `${context} > @class`);
      }
    }

    const ancestry = opening ? [...parents, opening] : parents;
    for (const child of node.childNodes ?? node.content?.childNodes ?? []) {
      visit(child, ancestry, affordance || isAffordance(tag, opening ?? ''));
    }
  }

  visit(parse(source, { sourceCodeLocationInfo: true }), []);
}

// Source-only traversal. Build output, dependencies, test artwork and unreferenced media
// are outside the UI candidate baseline. Static module imports in test files are still checked.
async function filesIn(root, base) {
  let entries;
  try {
    entries = await readdir(join(root, base), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = `${base}/${entry.name}`;
    if (entry.isDirectory() && !generated.has(entry.name))
      files.push(...(await filesIn(root, path)));
    if (entry.isFile()) files.push(path);
  }
  return files;
}

async function readSource(root, path) {
  try {
    return await readFile(join(root, path), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
}

/**
 * Discover static icon imports and UI candidates, independent of the exception manifest.
 * @returns {Promise<Array<{path: string, kind: string, context: string}>>}
 */
export async function scanIconUsage(root) {
  const files = [
    ...(await Promise.all(sourceRoots.map((base) => filesIn(root, base)))).flat(),
    ...(await Promise.all(apps.map((app) => filesIn(root, `${app}/public`)))).flat(),
    ...apps.map((app) => `${app}/index.html`),
  ].sort();
  const findings = [];
  for (const path of files) {
    const script = scriptFile.test(path);
    const css = path.endsWith('.css');
    const html = path.endsWith('.html');
    const manifest = path.endsWith('.webmanifest') || path.endsWith('/public/manifest.json');
    if (!(script || css || html || manifest)) continue;
    const source = await readSource(root, path);
    if (source === undefined) continue;

    const occurrences = new Map();
    const add = (kind, context) => {
      const exact = normalize(context);
      const key = JSON.stringify([kind, exact]);
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);
      findings.push({
        path,
        kind,
        context: occurrence === 1 ? exact : `${exact} (occurrence ${occurrence})`,
      });
    };
    if (script) scanScript(source, path, add, { importsOnly: fixturePath.test(path) });
    if (css && !fixturePath.test(path)) scanCss(source, path, add);
    if (html && !fixturePath.test(path)) scanHtml(source, path, add);
    if (manifest) {
      for (const icon of JSON.parse(source).icons ?? []) {
        add('image-or-css-icon', `manifest icons > ${JSON.stringify(icon)}`);
      }
    }
  }
  return findings;
}

function findingKey({ path, kind, context }) {
  return JSON.stringify([path, kind, context]);
}

function validException(entry) {
  return (
    entry &&
    typeof entry.path === 'string' &&
    entry.path.length > 0 &&
    !/[?*\\[\]{}]/.test(entry.path) &&
    !posix.isAbsolute(entry.path) &&
    !entry.path.startsWith('../') &&
    posix.normalize(entry.path) === entry.path &&
    candidateKinds.has(entry.kind) &&
    typeof entry.context === 'string' &&
    entry.context.length > 0 &&
    normalize(entry.context) === entry.context &&
    categories.has(entry.category) &&
    typeof entry.reason === 'string' &&
    entry.reason.trim().length > 0
  );
}

export function reviewIconUsage(findings, exceptions) {
  const result = { approved: [], forbidden: [], invalid: [], stale: [], unclassified: [] };
  const exact = new Map();
  for (const entry of exceptions) {
    if (!validException(entry) || exact.has(findingKey(entry))) {
      result.invalid.push(entry);
    } else {
      exact.set(findingKey(entry), entry);
    }
  }
  for (const finding of findings) {
    if (forbiddenKinds.has(finding.kind)) result.forbidden.push(finding);
    else if (exact.delete(findingKey(finding))) result.approved.push(finding);
    else result.unclassified.push(finding);
  }
  result.stale = [...exact.values()];
  return result;
}

async function main() {
  const root = process.cwd();
  const exceptions = JSON.parse(await readFile(join(root, 'tools/icon-exceptions.json'), 'utf8'));
  if (!Array.isArray(exceptions))
    throw new Error('Expected an array in tools/icon-exceptions.json');
  const findings = await scanIconUsage(root);
  const { approved, forbidden, invalid, stale, unclassified } = reviewIconUsage(
    findings,
    exceptions,
  );
  console.log(
    `Icon check: ${findings.length} findings, ${approved.length} approved, ${unclassified.length} unclassified, ` +
      `${forbidden.length} forbidden, ${stale.length} stale, ${invalid.length} invalid.`,
  );
  for (const [label, entries] of Object.entries({ forbidden, unclassified, stale, invalid })) {
    for (const entry of entries) console.error(`${label}: ${JSON.stringify(entry)}`);
  }
  if (forbidden.length || unclassified.length || stale.length || invalid.length)
    process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main().catch((error) => {
    console.error(`Icon check: ${error.message}`);
    process.exitCode = 1;
  });
}
