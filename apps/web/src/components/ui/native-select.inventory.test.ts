import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';

// Prevent one-off native fields from silently reintroducing the old browser arrow.
// Custom Radix/SearchableSelect widgets keep their own accessible implementation.
describe('shared native dropdown inventory', () => {
  it('only renders raw single-choice selects inside the two app primitives', () => {
    const root = resolve(process.cwd(), '../..');
    const allowed = new Set([
      'apps/web/src/components/ui/native-select.tsx',
      'apps/web-shop/src/components/ui/native-select.tsx',
    ]);
    const found: string[] = [];
    const datalists: string[] = [];
    function visit(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (!['__tests__', 'test', 'tests', 'node_modules', 'dist'].includes(entry.name)) visit(file);
        } else if (/\.[jt]sx?$/.test(entry.name) && !/[.-](test|spec|docs-spec)\.[jt]sx?$/.test(entry.name)) {
          const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
          const inspect = (node: ts.Node) => {
            if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === 'select') found.push(relative(root, file));
            if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === 'datalist') datalists.push(relative(root, file));
            ts.forEachChild(node, inspect);
          };
          inspect(ast);
        }
      }
    }
    for (const app of ['web', 'web-shop', 'card-reader']) visit(resolve(root, `apps/${app}/src`));
    visit(resolve(root, 'packages'));
    expect(found.sort()).toEqual([...allowed].sort());
    expect(datalists).toEqual([]);
  });
});
