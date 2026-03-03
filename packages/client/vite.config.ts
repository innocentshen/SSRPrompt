import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  root: __dirname,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@ssrprompt/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
            return 'vendor-react';
          }
          if (id.includes('i18next') || id.includes('react-i18next')) {
            return 'vendor-i18n';
          }
          if (id.includes('lucide-react') || id.includes('react-markdown') || id.includes('remark-gfm')) {
            return 'vendor-ui';
          }
          if (id.includes('zustand') || id.includes('@supabase')) {
            return 'vendor-data';
          }
          return 'vendor-misc';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
