import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.join(process.env.CREDIT_REPO_ROOT, 'apps/web');
const require = createRequire(path.join(root, 'package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const server = await createServer({
  root,
  configFile: path.join(root, 'vite.config.ts'),
  server: {
    host: '127.0.0.1',
    port: Number(process.env.CREDIT_PREVIEW_PORT || 5187),
    strictPort: true,
    proxy: { '/api': { target: process.env.CREDIT_API_ORIGIN, changeOrigin: true } },
  },
});
await server.listen();
process.send?.({ ready: true });
server.printUrls();
