import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'node:http';
import { exec } from 'node:child_process';
import { platform } from 'node:process';

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
          // Robustly determine base URL
          const protocol = req.headers['x-forwarded-proto'] || 'http';
          const host = req.headers.host || 'localhost';
          const urlObj = new URL(req.url || '', `${protocol}://${host}`);
          const subnet = urlObj.searchParams.get('subnet'); // 例: "192.168.1"

          if (!subnet) {
            next();
            return;
          }

          // 指定IPのポート8000にアクセスして生存確認する関数
          const checkHost = (ip: string) => {
            return new Promise<string | null>((resolve) => {
              const request = http.get(`http://${ip}:8000/metrics`, {
                timeout: 2000, // 遠隔地も考慮してタイムアウトを2000msに延長
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
        // 2. システムPing API (接続診断用)
        // =========================================
        server.middlewares.use('/api/sys-ping', (req, res, next) => {
           const protocol = req.headers['x-forwarded-proto'] || 'http';
           const host = req.headers.host || 'localhost';
           const urlObj = new URL(req.url || '', `${protocol}://${host}`);
           const target = urlObj.searchParams.get('target');
           
           if (!target) {
             next();
             return;
           }

           // 簡易サニタイズ (IPアドレスまたはホスト名)
           if (!/^[a-zA-Z0-9.\-_]+$/.test(target)) {
             res.statusCode = 400;
             res.setHeader('Content-Type', 'application/json');
             res.end(JSON.stringify({ error: 'Invalid target format' }));
             return;
           }
           
           // OS判定してPingコマンドを決定
           const isWin = platform === 'win32';
           const cmd = isWin 
             ? `ping -n 1 -w 2000 ${target}` 
             : `ping -c 1 -W 2 ${target}`;
             
           exec(cmd, (error, stdout, stderr) => {
             res.setHeader('Content-Type', 'application/json');
             // pingコマンドは到達不能の場合に終了コード非0を返すことが多い
             if (error) {
               res.end(JSON.stringify({ reachable: false, output: stdout || stderr }));
             } else {
               res.end(JSON.stringify({ reachable: true, output: stdout }));
             }
           });
        });

        // =========================================
        // 3. プロキシ API (native http モジュール版)
        // =========================================
        server.middlewares.use('/api/proxy', (req, res, next) => {
          const protocol = req.headers['x-forwarded-proto'] || 'http';
          const host = req.headers.host || 'localhost';
          const urlObj = new URL(req.url || '', `${protocol}://${host}`);
          const target = urlObj.searchParams.get('target');

          if (!target) {
            next();
            return;
          }

          // Validate target URL
          try {
            new URL(target);
          } catch (e) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Invalid target URL' }));
            return;
          }

          // Use native http.request for better control
          const proxyReq = http.request(target, {
            method: 'GET',
            timeout: 5000, // Explicit timeout 5s
            headers: {
              'User-Agent': 'GPU-Lab-Monitor-Proxy/1.0',
              // Forward Accept header if present
              'Accept': req.headers['accept'] || '*/*',
            }
          }, (proxyRes) => {
            res.statusCode = proxyRes.statusCode || 200;
            
            // Forward headers
            for (const [key, value] of Object.entries(proxyRes.headers)) {
               if (value) res.setHeader(key, value);
            }
            
            // Ensure CORS on the proxy response
            res.setHeader('Access-Control-Allow-Origin', '*');

            // Pipe the data directly
            proxyRes.pipe(res);
          });

          proxyReq.on('error', (err) => {
            console.error(`[Proxy Error] Failed to fetch ${target}:`, err.message);
            if (!res.headersSent) {
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ 
                status: 'error', 
                message: 'Proxy failed to fetch data from target server.',
                details: err.message
              }));
            }
          });

          proxyReq.on('timeout', () => {
             proxyReq.destroy();
             if (!res.headersSent) {
               res.statusCode = 504;
               res.setHeader('Content-Type', 'application/json');
               res.end(JSON.stringify({ status: 'error', message: 'Proxy timeout' }));
             }
          });

          proxyReq.end();
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