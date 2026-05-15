import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { readFileSync } from 'node:fs';

// Read version from package.json — single source of truth. Bump that file
// on every deploy (CalVer YY.M.PATCH, e.g. "26.5.1"). GIT_COMMIT is set by
// the CI workflow at build time; defaults to 'dev' for local builds.
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));
const APP_VERSION = pkg.version as string;
const BUILD_TIME = new Date().toISOString();
const GIT_COMMIT = (process.env.GIT_COMMIT ?? 'dev').slice(0, 7);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
    __GIT_COMMIT__: JSON.stringify(GIT_COMMIT),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@installment/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom/') || id.includes('node_modules/react/') || id.includes('node_modules/react-router/')) return 'vendor';
          if (id.includes('node_modules/@tanstack/react-query/')) return 'query';
          if (id.includes('node_modules/@line/liff/')) return 'liff';
          if (id.includes('node_modules/exceljs/')) return 'excel';
          if (id.includes('node_modules/jspdf')) return 'pdf';
          if (id.includes('node_modules/recharts/')) return 'charts';
        },
      },
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
    watch: {
      // Exclude heavy directories from file watching to prevent CPU spikes
      ignored: ['**/node_modules/**', '**/.git/**'],
    },
  },
});
