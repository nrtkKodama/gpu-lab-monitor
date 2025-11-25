import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'api-proxy-middleware',
      configureServer(server) {
        // 簡易プロキシエンドポイント: /api/proxy?target=http://...
        server.middlewares.use('/api/proxy', async (req, res, next) => {
          const urlObj = new URL(req.url || '', `http://${req.headers.host}`);
          const target = urlObj.searchParams.get('target');

          if (!target) {
            res.statusCode = 400;
            res.end('Missing target parameter');
            return;
          }

          try {
            // Node.js 18+ の global fetch を使用
            // 管理サーバー(localhost)から対象のGPUサーバーへリクエストを飛ばす
            const response = await fetch(target);
            const text = await response.text();

            // レスポンスヘッダーの設定（CORS許可）
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.statusCode = response.status;
            res.end(text);
          } catch (error) {
            console.error(`[Proxy Error] Failed to fetch ${target}:`, error);
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ 
              status: 'error', 
              message: 'Proxy failed to fetch data from target server.',
              details: String(error)
            }));
          }
        });
      }
    }
  ],
  server: {
    host: true, // 0.0.0.0 でリッスン
    port: 3000,
    open: false
  },
});