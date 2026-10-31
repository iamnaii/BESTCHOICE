import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';

// Repo root, derived from this file (apps/web/src/components/ui) so the scan does
// not depend on the directory vitest was launched from.
const ROOT = resolve(__dirname, '../../../../..');
const SKIP_DIRS = new Set(['__tests__', 'test', 'tests', 'node_modules', 'dist']);
const SOURCE_FILE = /\.[jt]sx?$/;
const TEST_FILE = /[.-](test|spec|docs-spec)\.[jt]sx?$/;
// Cheap textual pre-filter: a JSX <select>/<datalist> element must contain `<`,
// optional whitespace/block comments, then the tag name. Only files that match are
// handed to the TypeScript parser — parsing all ~1.4k files made this test take
// ~1s locally and blow vitest's 5s default on a loaded CI runner (main deploy, 31 Oct).
// Whitespace = what TypeScript 5.9 accepts there: JS `\s` plus U+0085 (NEL) and U+200B
// (ZWSP) — checked by parsing `<{ch}select />` for every BMP code point.
const CANDIDATE = /<[\s\u0085\u200b]*(?:\/\*[\s\S]*?\*\/[\s\u0085\u200b]*)*(?:select|datalist)\b/;
// The scan is still I/O over the whole frontend tree; keep a generous ceiling so a
// busy runner cannot turn a guard test into a deploy blocker.
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

function jsxTagsIn(file: string, source: string): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const tags: string[] = [];
  const inspect = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      tags.push(node.tagName.getText(ast));
    ts.forEachChild(node, inspect);
  };
  inspect(ast);
  return tags;
}

// Prevent one-off native fields from silently reintroducing the old browser arrow.
// Custom Radix/SearchableSelect widgets keep their own accessible implementation.
describe('shared native dropdown inventory', () => {
  it(
    'only renders raw single-choice selects inside the two app primitives',
    () => {
      const allowed = new Set([
        'apps/web/src/components/ui/native-select.tsx',
        'apps/web-shop/src/components/ui/native-select.tsx',
      ]);
      const files = [
        ...['web', 'web-shop', 'card-reader'].flatMap((app) =>
          listSourceFiles(resolve(ROOT, `apps/${app}/src`)),
        ),
        ...listSourceFiles(resolve(ROOT, 'packages')),
      ];
      // Guard against the scan silently walking the wrong tree and passing vacuously.
      expect(files.length).toBeGreaterThan(500);

      const found: string[] = [];
      const datalists: string[] = [];
      for (const file of files) {
        const source = readFileSync(file, 'utf8');
        if (!CANDIDATE.test(source)) continue;
        for (const tag of jsxTagsIn(file, source)) {
          if (tag === 'select') found.push(relative(ROOT, file));
          if (tag === 'datalist') datalists.push(relative(ROOT, file));
        }
      }
      expect(found.sort()).toEqual([...allowed].sort());
      expect(datalists).toEqual([]);
    },
    SCAN_TIMEOUT_MS,
  );
});
