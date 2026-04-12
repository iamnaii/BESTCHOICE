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
