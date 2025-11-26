import { ServerNode, GPUInfo, ServerConfig } from '../types';

// ==========================================
// CONFIGURATION
// ==========================================

// true: 開発用デモデータを使用 (サーバー不要)
// false: 実際のサーバー(Python Agent)と通信
const USE_MOCK_MODE = false;

// ==========================================
// MOCK DATA GENERATOR
// ==========================================

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1) + min);

const USERS = ['tanaka', 'suzuki', 'sato', 'research_group_a', 'matsumoto'];
const CONTAINERS = ['pytorch_training_v1', 'llm_finetune', 'stable_diffusion_inf', 'jupyter_lab_cuda11'];
const GPU_NAMES = ['NVIDIA A100-SXM4-40GB', 'NVIDIA GeForce RTX 3090', 'NVIDIA RTX A6000'];

const generateProcess = (gpuIndex: number) => {
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
    const res = await fetch(url, { signal: controller.signal });
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
const attemptFetchTarget = async (address: string, name: string): Promise<any> => {
  const AGENT_PORT = 8000;
  let targetUrl = '';
  
  if (address.startsWith('http')) {
    targetUrl = `${address}/metrics`;
  } else {
    const hasPort = address.includes(':');
    if (hasPort) {
      targetUrl = `http://${address}/metrics`;
    } else {
      targetUrl = `http://${address}:${AGENT_PORT}/metrics`;
    }
  }

  // 1. Direct Fetch
  try {
    const res = await fetchWithTimeout(targetUrl, 1500);
    if (res.ok) {
      const json = await res.json();
      return json;
    }
  } catch (e) {
    // Direct failed, proceed to proxy
  }

  // 2. Proxy Fetch
  const proxyUrl = `/api/proxy?target=${encodeURIComponent(targetUrl)}`;
  const res = await fetchWithTimeout(proxyUrl, 5000); 
  if (!res.ok) {
    throw new Error(`Proxy status: ${res.status}`);
  }
  return await res.json();
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
        if (jsonData.status === 'online') {
            return { ...baseNode, status: 'online', ip: config.originalIp, gpus: jsonData.gpus };
        }
      } catch (e) {
        // Fallback to configured IP
      }
    }

    // Priority 2: Try Configured IP (e.g. localhost tunnel)
    const jsonData = await attemptFetchTarget(config.ip, config.name);
    if (jsonData.status === 'online') {
        return { ...baseNode, status: 'online', ip: config.ip, gpus: jsonData.gpus };
    }
    
    // If we got here but status is not online (error in json)
    return baseNode;
  } catch (e) {
    return baseNode;
  }
};

export const testServerConnection = async (ip: string) => {
  let pingOk = false;
  const hostOnly = ip.split(':')[0];
  
  try {
    const res = await fetch(`/api/sys-ping?target=${hostOnly}`);
    if (res.ok) {
      const data = await res.json();
      pingOk = data.reachable;
    }
  } catch (e) {
    console.warn("Ping API failed", e);
  }

  let agentOk = false;
  let message = "";
  try {
    // Test uses a temporary config object
    const data = await fetchRealServerData({ id: 'test', name: "Test", ip: ip });
    if (data.status === 'online') {
      agentOk = true;
      message = "接続成功: エージェントは正常に応答しています。";
    } else {
      message = "エージェント応答なし (Port 8000を確認してください)";
    }
  } catch (e) {
    message = String(e);
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
    const res = await fetch(`/api/scan?subnet=${subnetPrefix}`);
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