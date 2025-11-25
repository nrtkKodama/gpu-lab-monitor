export interface GPUProcess {
  pid: number;
  type: 'C' | 'G'; // Compute or Graphics
  processName: string;
  usedMemory: number; // in MiB
  user: string; // Docker owner or system user
  containerName?: string; // Docker container name
}

export interface GPUInfo {
  index: number;
  name: string;
  utilization: {
    gpu: number; // %
    memory: number; // %
  };
  memory: {
    total: number; // MiB
    used: number; // MiB
    free: number; // MiB
  };
  temperature: number; // Celsius
  power: {
    draw: number; // Watts
    limit: number; // Watts
  };
  processes: GPUProcess[];
}

export interface ServerNode {
  id: string;
  ip: string;
  name: string;
  status: 'online' | 'offline' | 'warning';
  lastUpdated: string;
  gpus: GPUInfo[];
}

export interface ServerConfig {
  name: string;
  ip: string;
  originalIp?: string; // Stores the real remote IP if 'ip' is set to localhost (tunnel)
}

export enum ViewState {
  DASHBOARD = 'DASHBOARD',
  DETAIL = 'DETAIL',
  HELP = 'HELP'
}