import React from 'react';
import { ServerNode } from '../types';
import { ArrowLeft, RefreshCw, Cpu, Thermometer, Box, Database, Zap } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface ServerDetailProps {
  server: ServerNode;
  onBack: () => void;
  onRefresh: () => void;
}

const ServerDetail: React.FC<ServerDetailProps> = ({ server, onBack, onRefresh }) => {
  const gpuData = server.gpus.map(g => ({
    name: `GPU ${g.index}`,
    util: g.utilization.gpu,
    mem: g.utilization.memory,
    temp: g.temperature,
  }));

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 pb-6">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-800 rounded-full transition-colors">
            <ArrowLeft size={24} />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
              {server.name}
              <span className="text-sm font-normal text-gray-500 bg-gray-800 px-2 py-1 rounded font-mono">{server.ip}</span>
            </h2>
            <p className="text-gray-400 text-sm mt-1">Last updated: {server.lastUpdated}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={onRefresh}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg transition-colors font-medium text-sm"
          >
            <RefreshCw size={16} />
            更新
          </button>
        </div>
      </div>

      {/* Metrics Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* GPU Utilization Chart */}
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Cpu size={18} className="text-blue-400" /> GPU & Memory Load
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={gpuData} barGap={0} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis dataKey="name" stroke="#9CA3AF" tick={{fontSize: 12}} />
                <YAxis stroke="#9CA3AF" tick={{fontSize: 12}} unit="%" />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: '#F3F4F6' }}
                  cursor={{fill: '#374151', opacity: 0.4}}
                />
                <Bar dataKey="util" name="GPU Util" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="mem" name="Mem Util" fill="#10B981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Temperature & Power & Memory */}
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700 overflow-y-auto max-h-[350px]">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Thermometer size={18} className="text-red-400" /> Thermal, Power & Memory
          </h3>
          <div className="space-y-4">
            {server.gpus.map((gpu) => (
              <div key={gpu.index} className="bg-gray-900/50 p-4 rounded-lg">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-medium text-gray-200">{gpu.name} <span className="text-gray-500 text-xs">[{gpu.index}]</span></span>
                  <div className="flex items-center gap-4 text-sm">
                    <span className={`flex items-center gap-1 ${gpu.temperature > 80 ? 'text-red-400' : 'text-gray-400'}`}>
                      <Thermometer size={14} /> {gpu.temperature}°C
                    </span>
                    <span className="flex items-center gap-1 text-yellow-400">
                      <Zap size={14} /> {gpu.power.draw}W
                    </span>
                  </div>
                </div>
                
                {/* Memory Bar Specific */}
                <div className="relative pt-1">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-400 flex items-center gap-1"><Database size={10}/> Memory Usage</span>
                    <span className="text-gray-300 font-mono">
                      <span className="font-bold text-white">{(gpu.memory.used / 1024).toFixed(1)} GB</span>
                      <span className="text-gray-500"> / {(gpu.memory.total / 1024).toFixed(0)} GB</span>
                    </span>
                  </div>
                  <div className="w-full bg-gray-700 h-2 rounded-full overflow-hidden">
                     <div 
                        className={`h-full ${gpu.utilization.memory > 90 ? 'bg-orange-500' : 'bg-indigo-500'}`}
                        style={{ width: `${(gpu.memory.used / gpu.memory.total) * 100}%`}}
                     ></div>
                  </div>
                  <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                    <span>{gpu.memory.used} MiB</span>
                    <span>{Math.round((gpu.memory.used / gpu.memory.total) * 100)}%</span>
                  </div>
                </div>

              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Process Table */}
      <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
        <div className="p-6 border-b border-gray-700">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Box size={18} className="text-orange-400" /> Active Processes & Containers
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-900/50 text-gray-400">
              <tr>
                <th className="px-6 py-3 font-medium">GPU ID</th>
                <th className="px-6 py-3 font-medium">PID</th>
                <th className="px-6 py-3 font-medium">Type</th>
                <th className="px-6 py-3 font-medium">Process Name</th>
                <th className="px-6 py-3 font-medium">User / Owner</th>
                <th className="px-6 py-3 font-medium">Docker Container</th>
                <th className="px-6 py-3 font-medium text-right">Memory</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {server.gpus.flatMap(gpu => 
                gpu.processes.map(proc => ({ ...proc, gpuIndex: gpu.index }))
              ).map((proc, idx) => (
                <tr key={`${proc.gpuIndex}-${proc.pid}-${idx}`} className="hover:bg-gray-700/50 transition-colors">
                  <td className="px-6 py-4 text-gray-300">GPU {proc.gpuIndex}</td>
                  <td className="px-6 py-4 font-mono text-gray-400">{proc.pid}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${proc.type === 'C' ? 'bg-blue-900 text-blue-300' : 'bg-gray-700 text-gray-300'}`}>
                      {proc.type}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-300 font-mono text-xs">{proc.processName}</td>
                  <td className="px-6 py-4 font-bold text-yellow-500">{proc.user}</td>
                  <td className="px-6 py-4 text-blue-400 font-mono text-xs">
                    {proc.containerName || '-'}
                  </td>
                  <td className="px-6 py-4 text-right text-gray-300">{proc.usedMemory} MiB</td>
                </tr>
              ))}
              {server.gpus.every(g => g.processes.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500 italic">
                    No active processes found on this server.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ServerDetail;