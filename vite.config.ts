import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'node:http';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'api-middleware',
      configureServer(server) {
        // =========================================
        // 1. 高速LANスキャン API
        // =========================================
        server.middlewares.use('/api/scan', async (req, res, next) => {
          const urlObj = new URL(req.url || '', `http://${req.headers.host}`);
          const subnet = urlObj.searchParams.get('subnet'); // 例: "192.168.1"

          if (!subnet) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing subnet parameter' }));
            return;
          }

          // 指定IPのポート8000にアクセスして生存確認する関数
          const checkHost = (ip: string) => {
            return new Promise<string | null>((resolve) => {
              const request = http.get(`http://${ip}:8000/metrics`, {
                timeout: 500, // 500msでタイムアウト（高速化の鍵）
              }, (response) => {
                if (response.statusCode === 200) {
                  resolve(ip);
                } else {
                  resolve(null);
                }
                response.resume(); // ストリームを破棄
              });

              request.on('error', () => resolve(null));
              request.on('timeout', () => {
                request.destroy();
                resolve(null);
              });
            });
          };

          // 1～254 まで一気に並列リクエスト作成
          const tasks = [];
          for (let i = 1; i < 255; i++) {
             tasks.push(checkHost(`${subnet}.${i}`));
          }

          try {
             // 並列実行
             const results = await Promise.all(tasks);
             const found = results.filter((ip): ip is string => ip !== null);
             
             res.setHeader('Content-Type', 'application/json');
             res.end(JSON.stringify(found));
          } catch (e) {
             console.error('Scan error:', e);
             res.statusCode = 500;
             res.end(JSON.stringify({ error: 'Internal Server Error during scan' }));
          }
        });

        // =========================================
        // 2. プロキシ API (既存機能)
        // =========================================
        server.middlewares.use('/api/proxy', async (req, res, next) => {
          const urlObj = new URL(req.url || '', `http://${req.headers.host}`);
          const target = urlObj.searchParams.get('target');

          if (!target) {
            res.statusCode = 400;
            res.end('Missing target parameter');
            return;
          }

          try {
            // Node.js 18+ global fetch
            const response = await fetch(target);
            const text = await response.text();

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
    host: true,
    port: 3000,
    open: false
  },
});
