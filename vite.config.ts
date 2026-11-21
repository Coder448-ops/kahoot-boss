import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // Allow preview/proxy hosts (sandbox + deploy previews). Dev-only setting.
    allowedHosts: true,
    // Same-origin access to the live connector during development.
    proxy: {
      '/live': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      // Dev-only: the serverless reserve relay has no local equivalent, so
      // local dev proxies it to the deployed site (real relay, real Kahoot).
      '/api/kahoot-reserve': {
        target: 'https://kahoot-boss.vercel.app',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});
