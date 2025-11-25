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
  const AGENT_PORT = 4274;
  
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
 * サーバー接続診断
 * Ping疎通確認とエージェント応答確認を行う
 */
export const testServerConnection = async (ip: string) => {
  // 1. Ping Check via Backend
  let pingOk = false;
  try {
    const res = await fetch(`/api/sys-ping?target=${ip}`);
    if (res.ok) {
      const data = await res.json();
      pingOk = data.reachable;
    }
  } catch (e) {
    console.warn("Ping API failed", e);
  }

  // 2. Agent Check via Real Data Fetch (which handles direct/proxy)
  let agentOk = false;
  let message = "";
  try {
    const data = await fetchRealServerData(ip, "Test");
    if (data.status === 'online') {
      agentOk = true;
      message = "接続成功: エージェントは正常に応答しています。";
    } else {
      message = "エージェント応答なし (Port 4274を確認してください)";
    }
  } catch (e) {
    message = String(e);
  }

  // 結果メッセージの生成
  if (pingOk && agentOk) {
    return { success: true, message: "✅ Ping: OK, Agent: OK - 正常に監視可能です。" };
  } else if (pingOk && !agentOk) {
    return { success: false, message: "⚠️ Ping: OK, Agent: NG - サーバーは存在しますが、エージェント(Port 4274)に繋がりません。ファイアウォール設定または monitor.py の起動状況を確認してください。" };
  } else if (!pingOk && agentOk) {
    // エージェントが見えているならPingが通らなくてもOK（ファイアウォール設定等）
    return { success: true, message: "✅ Ping: Blocked, Agent: OK - Pingは拒否されましたが、エージェントは応答しています。" };
  } else {
    return { success: false, message: "❌ Ping: NG, Agent: NG - サーバーに到達できません。IPアドレスとネットワーク接続を確認してください。" };
  }
};

/**
 * 高速ネットワークスキャン
 * 管理サーバー(Vite)の /api/scan エンドポイントを使用して、サーバー側で並列実行する
 */
export const scanLocalNetwork = async (subnetPrefix: string): Promise<string[]> => {
  console.log(`Starting fast server-side scan for ${subnetPrefix}.x ...`);
  try {
    // ブラウザから1つずつFetchすると時間がかかるため、
    // 管理サーバー(Node.js)に一括スキャンを依頼する
    const res = await fetch(`/api/scan?subnet=${subnetPrefix}`);
    
    if (!res.ok) {
      throw new Error(`Scan API error: ${res.status} ${res.statusText}`);
    }
    
    const foundIps: string[] = await res.json();
    return foundIps;
    
  } catch (e) {
    console.error("Fast scan failed:", e);
    // エラー時は空リストを返す
    return [];
  }
};

// ==========================================
// EXPORT
// ==========================================

export const fetchServerData = USE_MOCK_MODE ? fetchMockServerData : fetchRealServerData;
