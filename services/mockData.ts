import { ServerNode, GPUInfo, ServerConfig } from '../types';

// ==========================================
// CONFIGURATION
// ==========================================

// true: 開発用デモデータを使用 (サーバー不要)
// false: 実際のサーバー(Python Agent)と通信
const USE_MOCK_MODE = false;

// BACKEND API CONFIG
// GitHub Pagesなど、フロントエンドとバックエンドが別ドメインにある場合に使用
let BACKEND_BASE_URL = localStorage.getItem('backend_api_url') || '';

// 末尾のスラッシュを削除
if (BACKEND_BASE_URL.endsWith('/')) {
    BACKEND_BASE_URL = BACKEND_BASE_URL.slice(0, -1);
}

export const setBackendUrl = (url: string) => {
    BACKEND_BASE_URL = url.endsWith('/') ? url.slice(0, -1) : url;
    localStorage.setItem('backend_api_url', BACKEND_BASE_URL);
};

export const getBackendUrl = () => BACKEND_BASE_URL;

// ==========================================
// PERSISTENCE API (SHARED CONFIG)
// ==========================================

export const fetchServerConfig = async (): Promise<ServerConfig[]> => {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/servers`);
    if (!res.ok) throw new Error('Failed to fetch server config');
    return await res.json();
  } catch (e) {
    console.error("Config fetch failed:", e);
    return [];
  }
};

export const saveServerConfig = async (servers: ServerConfig[]): Promise<boolean> => {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(servers)
    });
    return res.ok;
  } catch (e) {
    console.error("Config save failed:", e);
    return false;
  }
};

// ==========================================
// MOCK DATA GENERATOR
// ==========================================

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1) + min);

// Realistic user names found in research labs (Env vars: JUPYTERHUB_USER, USER etc.)
const USERS = [
  'tanaka', 'suzuki', 'sato', 'matsumoto', 
  'lab_member_a', 'guest_researcher', 'jupyter-hama', 'u_12345678'
];
const CONTAINERS = ['pytorch_training_v1', 'llm_finetune', 'stable_diffusion_inf', 'jupyter_lab_cuda11', 'vscode-server'];
const GPU_NAMES = ['NVIDIA A100-SXM4-40GB', 'NVIDIA GeForce RTX 3090', 'NVIDIA RTX A6000'];

const generateProcess = (_gpuIndex: number) => {
  const isDocker = Math.random() > 0.3;
  return {
    pid: randomInt(1000, 99999),
    type: 'C' as const,
    processName: isDocker ? '/usr/bin/python3' : 'Xorg',
    usedMemory: randomInt(1000, 24000),
    user: isDocker ? USERS[randomInt(0, USERS.length - 1)] : 'root',
    containerName: isDocker ? CONTAINERS[randomInt(0, CONTAINERS.length - 1)] : undefined,
  };
};

const generateGPU = (index: number): GPUInfo => {
  const totalMem = 24576; // 24GB
  const usedMem = randomInt(100, totalMem);
  return {
    index,
    name: GPU_NAMES[randomInt(0, GPU_NAMES.length - 1)],
    utilization: {
      gpu: randomInt(0, 100),
      memory: Math.round((usedMem / totalMem) * 100),
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: totalMem - usedMem,
    },
    temperature: randomInt(30, 85),
    power: {
      draw: randomInt(50, 350),
      limit: 350,
    },
    processes: Array.from({ length: randomInt(0, 3) }, () => generateProcess(index)),
  };
};

export const fetchMockServerData = (ip: string, name: string): Promise<ServerNode> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      const gpuCount = randomInt(1, 4);
      const isOffline = Math.random() > 0.95;
      
      resolve({
        id: ip, // For mock, just use IP
        ip,
        name,
        status: isOffline ? 'offline' : 'online',
        lastUpdated: new Date().toLocaleTimeString(),
        gpus: isOffline ? [] : Array.from({ length: gpuCount }, (_, i) => generateGPU(i)),
      });
    }, 500);
  });
};

// ==========================================
// REAL API CLIENT
// ==========================================

const fetchWithTimeout = async (url: string, timeoutMs: number) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { 
      signal: controller.signal,
      headers: { 'Cache-Control': 'no-cache' } // Ensure fresh data
    });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
};

/**
 * Attempts to fetch metrics from a target address.
 */
const attemptFetchTarget = async (rawAddress: string, name: string): Promise<any> => {
  const AGENT_PORT = 8000;
  const address = rawAddress.trim(); // Trim spaces to avoid errors
  let targetUrl = '';
  
  // Ensure protocol is present
  if (address.startsWith('http://') || address.startsWith('https://')) {
     targetUrl = address.endsWith('/metrics') ? address : `${address}/metrics`;
  } else {
    // Basic IP/Hostname logic
    const hasPort = address.includes(':');
    if (hasPort) {
      targetUrl = `http://${address}/metrics`;
    } else {
      targetUrl = `http://${address}:${AGENT_PORT}/metrics`;
    }
  }

  // 1. Direct Fetch (Browser -> Agent)
  // This usually fails on GitHub Pages (HTTPS) -> Agent (HTTP) due to Mixed Content
  try {
    const res = await fetchWithTimeout(targetUrl, 2000); 
    if (res.ok) {
      const json = await res.json();
      return json;
    }
  } catch (e) {
    // Ignore direct fetch errors
  }

  // 2. Proxy Fetch (Browser -> Node Server -> Agent)
  // Uses BACKEND_BASE_URL if set (for remote access via GitHub Pages)
  try {
    const proxyPath = `${BACKEND_BASE_URL}/api/proxy?target=${encodeURIComponent(targetUrl)}`;
    const res = await fetchWithTimeout(proxyPath, 10000); 
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Proxy status: ${res.status} ${res.statusText} ${text}`);
    }
    return await res.json();
  } catch (e) {
    console.error(`All fetch attempts failed for ${name} (${address})`, e);
    throw e;
  }
};

export const fetchRealServerData = async (config: ServerConfig): Promise<ServerNode> => {
  const baseNode: ServerNode = {
    id: config.id, // VITAL: Preserve the unique ID from config
    ip: config.originalIp || config.ip,
    name: config.name,
    status: 'offline',
    lastUpdated: new Date().toLocaleTimeString(),
    gpus: [],
  };

  try {
    // Priority 1: Try Original IP (Real Remote IP)
    if (config.originalIp) {
      try {
        const jsonData = await attemptFetchTarget(config.originalIp, config.name);
        if (jsonData.status === 'online' || jsonData.gpus) {
            return { ...baseNode, status: 'online', ip: config.originalIp, gpus: jsonData.gpus || [] };
        }
      } catch (e) {
        // Fallback to configured IP
      }
    }

    // Priority 2: Try Configured IP (e.g. localhost tunnel or direct)
    const jsonData = await attemptFetchTarget(config.ip, config.name);
    
    // Check if valid data
    if (jsonData && (jsonData.status === 'online' || Array.isArray(jsonData.gpus))) {
        return { ...baseNode, status: 'online', ip: config.ip, gpus: jsonData.gpus || [] };
    }
    
    return baseNode;
  } catch (e) {
    return baseNode;
  }
};

export const testServerConnection = async (ip: string) => {
  const cleanIp = ip.trim();
  let pingOk = false;
  const hostOnly = cleanIp.split(':')[0];
  
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/sys-ping?target=${hostOnly}`);
    if (res.ok) {
      const data = await res.json();
      pingOk = data.reachable;
    }
  } catch (e) {
    console.warn("Ping API failed", e);
  }

  let agentOk = false;
  try {
    // Test uses a temporary config object
    const data = await fetchRealServerData({ id: 'test', name: "Test", ip: cleanIp });
    if (data.status === 'online') {
      agentOk = true;
    }
  } catch (e) {
    console.error(e);
  }

  if (pingOk && agentOk) {
    return { success: true, message: "✅ Ping: OK, Agent: OK - 正常に監視可能です。" };
  } else if (pingOk && !agentOk) {
    return { success: false, message: "⚠️ Ping: OK, Agent: NG - サーバーは存在しますが、エージェント(Port 8000)に繋がりません。ファイアウォール設定または monitor.py の起動状況を確認してください。" };
  } else if (!pingOk && agentOk) {
    return { success: true, message: "✅ Ping: Blocked, Agent: OK - Pingは拒否されましたが、エージェントは応答しています。" };
  } else {
    return { success: false, message: "❌ Ping: NG, Agent: NG - サーバーに到達できません。IPアドレスとネットワーク接続を確認してください。" };
  }
};

export const scanLocalNetwork = async (subnetPrefix: string): Promise<string[]> => {
  console.log(`Starting fast server-side scan for ${subnetPrefix}.x ...`);
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/scan?subnet=${subnetPrefix}`);
    if (!res.ok) throw new Error(`Scan API error: ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error("Fast scan failed:", e);
    return [];
  }
};

export const fetchServerData = (config: ServerConfig): Promise<ServerNode> => {
  if (USE_MOCK_MODE) {
    return fetchMockServerData(config.ip, config.name);
  }
  return fetchRealServerData(config);
};