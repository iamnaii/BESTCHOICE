// Vite treats port zero as its default. Start in the ephemeral range and let Vite
// bind the first available port; report the port it actually owns.
import { createServer } from 'vite';
import { randomInt } from 'node:crypto';
import { resolve } from 'node:path';
const [apiOrigin, runId] = process.argv.slice(2);
if (!process.send || !/^http:\/\/127\.0\.0\.1:\d+$/.test(apiOrigin))
  throw Error('Expected isolated API');
const root = resolve('apps/web');
const server = await createServer({
  root,
  envDir: false,
  cacheDir: resolve(process.env.DOCS_QA_OUTPUT, 'vite-cache'),
  configFile: resolve(root, 'vite.config.ts'),
  server: {
    host: '127.0.0.1',
    port: randomInt(49152, 64000),
    strictPort: false,
    proxy: { '/api': { target: apiOrigin, changeOrigin: true } },
  },
  plugins: [
    {
      name: 'tooltify-preview-identity',
      configureServer(server) {
        server.middlewares.use('/__tooltify_run', (_req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ runId, apiOrigin }));
        });
      },
    },
  ],
});
await server.listen();
process.send({ baseURL: `http://127.0.0.1:${server.httpServer.address().port}` });
process.on('disconnect', () => {
  void server.close().then(() => process.exit(0));
});
