import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startStaticServer } from '../../apps/web-shop/e2e/fixtures/static-server.mjs';

const [app, portText] = process.argv.slice(2);
const port = Number(portText);
if (!['web', 'web-shop'].includes(app) || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Usage: node tools/icons/serve-toast-fixture.mjs <web|web-shop> <port>');
}
const repo = fileURLToPath(new URL('../../', import.meta.url));
const appRoot = join(repo, 'apps', app);
const requireApp = createRequire(join(appRoot, 'package.json'));
const viteRoot = dirname(requireApp.resolve('vite/package.json'));
const sonnerRoot = dirname(dirname(requireApp.resolve('sonner')));
const { build, version } = await import(pathToFileURL(join(viteRoot, 'dist/node/index.js')));
const directory = join(repo, '.tmp/icons/toast-fixtures', app);
const source = join(directory, 'src');
const dist = join(directory, 'dist');
const input = join(source, 'index.html');
const isAdmin = app === 'web';

await mkdir(source, { recursive: true });
await writeFile(
  input,
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sonner icon fixture</title><div id="root"></div><script type="module" src="./main.tsx"></script></html>',
);
const importPath = (name) => JSON.stringify(join(appRoot, 'src', name));
await writeFile(
  join(source, 'fixture.css'),
  `
@import ${importPath('index.css')};
@source ${importPath('components/ui/sonner.tsx')};
@source "./main.tsx";
`,
);
await writeFile(
  join(source, 'main.tsx'),
  `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from ${importPath('components/ui/sonner.tsx')};
import { toast } from 'fixture-sonner';
import './fixture.css';
${isAdmin ? "import { ThemeProvider } from 'next-themes';" : ''}

function Fixture() {
  function showVariants() {
    toast.success('Success fixture');
    toast.info('Info fixture');
    toast.warning('Warning fixture');
    toast.error('Error fixture');
    toast.loading('Loading fixture');
    toast('Dismissible fixture', { closeButton: true });
  }
  return (
    <>
      <button type="button" className="fixed bottom-2 left-4 min-h-11" onClick={showVariants}>
        Show toast variants
      </button>
      <Toaster richColors expand position="top-center" visibleToasts={6} duration={60_000}
        ${isAdmin ? 'toastOptions={{ closeButtonAriaLabel: "Dismiss fixture toast" }}' : ''}
      />
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  ${isAdmin ? '<ThemeProvider attribute="class" defaultTheme="system"><Fixture /></ThemeProvider>' : '<Fixture />'},
);
`,
);
await build({
  root: source,
  configFile: join(appRoot, 'vite.config.ts'),
  publicDir: join(appRoot, 'public'),
  ...(isAdmin ? {} : { css: { postcss: appRoot } }),
  logLevel: 'warn',
  resolve: { alias: { 'fixture-sonner': join(sonnerRoot, 'dist/index.mjs') } },
  build: {
    outDir: dist,
    emptyOutDir: true,
    sourcemap: false,
    ...(version.startsWith('8.') ? { rolldownOptions: { input } } : { rollupOptions: { input } }),
  },
});
await copyFile(join(dist, 'index.html'), join(dist, 'spa-shell.html'));
const sonnerVersion = JSON.parse(await readFile(join(sonnerRoot, 'package.json'), 'utf8')).version;
const server = await startStaticServer({ port, root: dist });
console.log(`${app} Sonner ${sonnerVersion} fixture at ${server.url}`);
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => server.close());
}
