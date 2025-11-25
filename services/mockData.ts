import { ServerNode, GPUInfo } from '../types';

// ==========================================
// MOCK DATA GENERATOR (For Demo/Development)
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
// REAL API CLIENT (For Production)
// ==========================================

export const fetchRealServerData = async (ip: string, name: string): Promise<ServerNode> => {
  try {
    // Agent port is assumed to be 8000
    // Note: If you deploy agent on a different port, update it here.
    const AGENT_PORT = 8000;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout

    const response = await fetch(`http://${ip}:${AGENT_PORT}/metrics`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Error: ${response.status}`);
    }

    const data = await response.json();
    
    return {
      id: ip,
      ip,
      name,
      status: 'online',
      lastUpdated: new Date().toLocaleTimeString(),
      gpus: data.gpus || [], // Assuming backend returns { gpus: [...] }
    };
  } catch (error) {
    console.error(`Failed to fetch from ${ip}:`, error);
    return {
      id: ip,
      ip,
      name,
      status: 'offline', // or 'warning'
      lastUpdated: new Date().toLocaleTimeString(),
      gpus: [],
    };
  }
};

export const scanLocalNetwork = (): Promise<string[]> => {
  // Browser cannot perform real network scans due to sandbox restrictions.
  // In a real app, you might manually add IPs or fetch a list from a central registry.
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        '192.168.1.101',
        '192.168.1.105',
        '192.168.1.110',
        '192.168.1.150'
      ]);
    }, 1500);
  });
};

// ==========================================
// EXPORT CONFIGURATION
// ==========================================

// [MODE SELECTION]
// デモデータ(Mock)を使用するか、実機(Real)と通信するかをここで切り替えます。
// Toggle comment out to switch modes.

// 1. デモモード (開発用 - サーバー不要)
export const fetchServerData = fetchMockServerData;

// 2. 本番モード (実機用 - Pythonエージェントが必要)
// export const fetchServerData = fetchRealServerData;
