const express = require('express');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');
const fs = require('fs');

const app = express();
// Listen on all network interfaces (0.0.0.0) so it is accessible from other machines
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// Check if build directory exists
const BUILD_DIR = path.join(__dirname, 'dist');
if (!fs.existsSync(BUILD_DIR)) {
  console.error('\x1b[31m%s\x1b[0m', 'Error: "dist" directory not found.');
  console.error('Please run "npm run build" before starting the production server.');
  process.exit(1);
}

// Serve static files from the build directory
app.use(express.static(BUILD_DIR));

// =========================================
// 1. LAN Scan API
// =========================================
app.get('/api/scan', async (req, res) => {
  const subnet = req.query.subnet;
  if (!subnet) return res.json([]);

  const checkHost = (ip) => {
    return new Promise((resolve) => {
      // Short timeout for scanning
      const request = http.get(`http://${ip}:8000/metrics`, { timeout: 2000 }, (response) => {
        if (response.statusCode === 200) {
          resolve(ip);
        } else {
          resolve(null);
        }
        response.resume(); // Consume response data to free up memory
      });

      request.on('error', () => resolve(null));
      request.on('timeout', () => {
        request.destroy();
        resolve(null);
      });
    });
  };

  const tasks = [];
  // Scan .1 to .254
  for (let i = 1; i < 255; i++) {
    tasks.push(checkHost(`${subnet}.${i}`));
  }

  try {
    const results = await Promise.all(tasks);
    const found = results.filter(ip => ip !== null);
    res.json(found);
  } catch (e) {
    console.error('Scan error:', e);
    res.status(500).json({ error: 'Internal Server Error during scan' });
  }
});

// =========================================
// 2. System Ping API
// =========================================
app.get('/api/sys-ping', (req, res) => {
  const target = req.query.target;
  
  // Basic Input Sanitization
  if (!target || !/^[a-zA-Z0-9.\-_]+$/.test(target)) {
    return res.status(400).json({ error: 'Invalid target format' });
  }

  const isWin = process.platform === 'win32';
  const cmd = isWin 
    ? `ping -n 1 -w 2000 ${target}` 
    : `ping -c 1 -W 2 ${target}`;
    
  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      res.json({ reachable: false, output: stdout || stderr });
    } else {
      res.json({ reachable: true, output: stdout });
    }
  });
});

// =========================================
// 3. Proxy API (Robust implementation)
// =========================================
app.get('/api/proxy', (req, res) => {
  const target = req.query.target;
  if (!target) {
    return res.status(400).json({ error: 'Missing target parameter' });
  }

  // Validate URL
  try {
    new URL(target);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid target URL' });
  }

  // Use native http.request for better control over timeouts and headers
  const proxyReq = http.request(target, {
    method: 'GET',
    timeout: 5000, // 5s timeout
    headers: {
      'User-Agent': 'GPU-Lab-Monitor-Proxy/1.0',
      // Forward Accept header if present
      'Accept': req.headers['accept'] || '*/*',
    }
  }, (proxyRes) => {
    res.status(proxyRes.statusCode || 200);
    
    // Forward headers from the agent
    for (const [key, value] of Object.entries(proxyRes.headers)) {
       // Filter out problematic headers if necessary, but generally forward all
       if (value) res.setHeader(key, value);
    }
    
    // Ensure CORS on the proxy response so the frontend can read it
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Pipe the data directly to the client response
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`[Proxy Error] Failed to fetch ${target}:`, err.message);
    if (!res.headersSent) {
      res.status(502).json({ 
        status: 'error', 
        message: 'Proxy failed to fetch data from target server.',
        details: err.message
      });
    }
  });

  proxyReq.on('timeout', () => {
     proxyReq.destroy();
     if (!res.headersSent) {
       res.status(504).json({ status: 'error', message: 'Proxy timeout' });
     }
  });

  proxyReq.end();
});

// SPA Fallback: Serve index.html for any unknown routes (React Router)
app.get('*', (req, res) => {
  res.sendFile(path.join(BUILD_DIR, 'index.html'));
});

// Start Server
app.listen(PORT, HOST, () => {
  console.log(`\n==================================================`);
  console.log(`   GPU Lab Monitor (Production Server)`);
  console.log(`==================================================`);
  console.log(`Running at: http://${HOST}:${PORT}`);
  console.log(`Serving build from: ${BUILD_DIR}`);
  console.log(`Ready to accept connections.`);
});
