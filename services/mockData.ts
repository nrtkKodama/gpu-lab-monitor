import { ServerNode, GPUInfo } from '../types';

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
    // Simulate network latency
    setTimeout(() => {
      const gpuCount = randomInt(1, 4);
      const isOffline = Math.random() > 0.95;
      
      resolve({
        id: ip,
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

/**
 * タイムアウト付きFetchラッパー
 */
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

export const fetchRealServerData = async (address: string, name: string): Promise<ServerNode> => {
  const AGENT_PORT = 8000;
  
  // addressが "http" で始まらない場合は補完する
  const targetUrl = address.startsWith('http') 
    ? `${address}/metrics`
    : `http://${address}:${AGENT_PORT}/metrics`;

  let jsonData: any = null;
  let isProxyUsed = false;

  try {
    // ---------------------------------------------------------
    // 1. まず直接通信を試みる (LAN内PC用: 高速)
    // ---------------------------------------------------------
    try {
      // タイムアウトを短く設定(1.5秒)して、ダメならすぐプロキシへ
      const res = await fetchWithTimeout(targetUrl, 1500);
      if (res.ok) {
        jsonData = await res.json();
      }
    } catch (e) {
      // Direct access fail is expected if client is remote. Ignore error and fallback.
    }

    // ---------------------------------------------------------
    // 2. 失敗した場合、管理サーバー経由(Proxy)で試みる (SSHトンネル/リモート用)
    // ---------------------------------------------------------
    if (!jsonData) {
      // プロキシURL: 現在のページホスト(localhost:3000)のAPIを叩く
      const proxyUrl = `/api/proxy?target=${encodeURIComponent(targetUrl)}`;
      isProxyUsed = true;
      
      const res = await fetchWithTimeout(proxyUrl, 10000); // 10秒タイムアウト(重い処理のため)
      
      if (!res.ok) {
        throw new Error(`Proxy Error: ${res.status} ${res.statusText}`);
      }
      jsonData = await res.json();
      
      // プロキシ自体がエラーJSONを返してきた場合
      if (jsonData.status === 'error' && jsonData.message) {
        throw new Error(`Proxy Upstream Error: ${jsonData.message}`);
      }
    }

    // データ整形
    return {
      id: address,
      ip: address, 
      name: name,
      status: 'online',
      lastUpdated: new Date().toLocaleTimeString(),
      gpus: jsonData.gpus || [], 
    };

  } catch (error) {
    // Error Handling & Logging
    let msg = String(error);
    let isTimeout = false;
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        msg = isProxyUsed 
          ? 'Timeout (Proxy)' 
          : 'Timeout';
        isTimeout = true;
      } else {
        msg = error.message;
      }
    }

    if (!isTimeout) {
      // タイムアウト以外のエラーはコンソールに出してデバッグしやすくする
      console.warn(`[GPU-Monitor] Failed to fetch from ${address}:`, msg);
    }
    
    return {
      id: address,
      ip: address,
      name: name,
      status: 'offline', // warning ではなく offline にして分かりやすく
      lastUpdated: new Date().toLocaleTimeString(),
      gpus: [],
    };
  }
};

/**
 * 実ネットワークスキャン関数
 * @param subnetPrefix "192.168.1" のような3オクテット
 */
export const scanLocalNetwork = async (subnetPrefix: string): Promise<string[]> => {
  const activeIps: string[] = [];
  
  // 1-254 のレンジをスキャン
  const targets = Array.from({ length: 254 }, (_, i) => i + 1);
  
  // バッチサイズ: ブラウザの同時接続制限を考慮して小さめに分割
  const BATCH_SIZE = 20;
  
  // スキャン用の軽量Fetch関数 (Timeout短め)
  const checkHost = async (i: number): Promise<string | null> => {
    const ip = `${subnetPrefix}.${i}`;
    try {
      // プロキシは使わず、まず直接通信を試みる（スキャンの高速化のため）
      // ※注意: SSHポートフォワーディング環境では、直接通信が届かないため全滅する可能性がある。
      // そのため、fetchRealServerDataを使って賢く判定するが、タイムアウトを極端に短くする。
      
      const result = await fetchRealServerData(ip, 'scan-temp');
      if (result.status === 'online') {
        return ip;
      }
    } catch (e) {
      // ignore
    }
    return null;
  };

  // バッチ実行
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    const promises = batch.map(num => checkHost(num));
    const results = await Promise.all(promises);
    
    results.forEach(ip => {
      if (ip) activeIps.push(ip);
    });
  }

  return activeIps;
};

// ==========================================
// EXPORT
// ==========================================

export const fetchServerData = USE_MOCK_MODE ? fetchMockServerData : fetchRealServerData;