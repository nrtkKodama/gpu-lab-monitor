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

export const fetchRealServerData = async (address: string, name: string): Promise<ServerNode> => {
  try {
    const AGENT_PORT = 8000;
    
    // addressが "http" で始まらない場合は補完する
    // ngrokのURLなどが直接入力された場合に対応
    const url = address.startsWith('http') 
      ? `${address}/metrics`
      : `http://${address}:${AGENT_PORT}/metrics`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch(url, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Error: ${response.status}`);
    }

    const data = await response.json();
    
    return {
      id: address,
      ip: address, // Display raw input as IP/Host
      name: name,
      status: 'online',
      lastUpdated: new Date().toLocaleTimeString(),
      gpus: data.gpus || [], 
    };
  } catch (error) {
    console.warn(`Failed to fetch from ${address}:`, error);
    return {
      id: address,
      ip: address,
      name: name,
      status: 'offline', 
      lastUpdated: new Date().toLocaleTimeString(),
      gpus: [],
    };
  }
};

export const scanLocalNetwork = (): Promise<string[]> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        '192.168.1.101',
        '192.168.1.105',
      ]);
    }, 1500);
  });
};

// ==========================================
// EXPORT
// ==========================================

export const fetchServerData = USE_MOCK_MODE ? fetchMockServerData : fetchRealServerData;