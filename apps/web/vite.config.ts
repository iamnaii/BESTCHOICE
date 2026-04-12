import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@installment/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          liff: ['@line/liff'],
          // Heavy libs split into separate chunks so the initial JS bundle
          // doesn't pay for them on every page load. Each chunk only
          // downloads when a page that uses it is navigated to.
          excel: ['exceljs'],
          pdf: ['jspdf', 'jspdf-autotable'],
          charts: ['recharts'],
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
