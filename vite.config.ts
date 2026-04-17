import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        status: resolve(__dirname, 'status.html'),
        control: resolve(__dirname, 'control.html'),
      },
    },
  },
});
