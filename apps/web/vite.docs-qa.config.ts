import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

/**
 * Documents integration harness (apps/api/e2e/documents/support/web.ts):
 * same app config as `vite.config.ts`, but `/api` is proxied to the in-process
 * API of the current run instead of localhost:3000. Never used for builds.
 */
export default mergeConfig(
  base,
  defineConfig({
    server: {
      proxy: {
        '/api': {
          target: process.env.DOCS_QA_API_ORIGIN ?? 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  }),
);
