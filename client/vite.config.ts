import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/drivers': 'http://localhost:3000',
      '/rides': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
});
