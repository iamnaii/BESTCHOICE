import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

let cachedIconsDir: string | null = null;

function resolveIconsDir(): string {
  if (cachedIconsDir) return cachedIconsDir;
  const pkgPath = require.resolve('lucide-static/package.json');
  cachedIconsDir = join(dirname(pkgPath), 'icons');
  return cachedIconsDir;
}

/**
 * Load a Lucide SVG icon as an inline string.
 * The returned SVG has `stroke="currentColor"` so callers can color it via CSS.
 */
export function loadIcon(name: string): string {
  const filePath = join(resolveIconsDir(), `${name}.svg`);
  return readFileSync(filePath, 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();
}
