import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // これにより 0.0.0.0 でリッスンし、外部からIP指定でアクセス可能になります
    port: 3000,
    open: false // サーバー上でブラウザを起動しようとするのを防ぎます
  },
});