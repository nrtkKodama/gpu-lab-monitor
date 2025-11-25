import React from 'react';
import { ServerNode } from '../types';
import { Server, AlertTriangle, Cpu, Thermometer, Database } from 'lucide-react';

interface ServerCardProps {
  server: ServerNode;
  onClick: (server: ServerNode) => void;
  onRemove: (ip: string) => void;
}

const ServerCard: React.FC<ServerCardProps> = ({ server, onClick, onRemove }) => {
  const isOnline = server.status === 'online';
  
  // Aggregate stats
  const totalGpus = server.gpus.length;
  
  // Define "Free" as utilization < 5%
  const freeGpus = isOnline ? server.gpus.filter(g => g.utilization.gpu < 5).length : 0;
  
  const avgUtil = totalGpus > 0 
    ? Math.round(server.gpus.reduce((acc, gpu) => acc + gpu.utilization.gpu, 0) / totalGpus)
    : 0;
    
  const maxTemp = totalGpus > 0
    ? Math.max(...server.gpus.map(g => g.temperature))
    : 0;

  // Memory Aggregation (MiB)
  const totalMemMiB = server.gpus.reduce((acc, g) => acc + g.memory.total, 0);
  const usedMemMiB = server.gpus.reduce((acc, g) => acc + g.memory.used, 0);
  
  // Convert to GB for display
  const totalMemGB = (totalMemMiB / 1024).toFixed(0);
  const usedMemGB = (usedMemMiB / 1024).toFixed(1);
  
  // Card border color based on status
  const statusColor = !isOnline 
    ? 'bg-red-900/10 border-red-900/50' 
    : maxTemp > 80 
      ? 'bg-orange-900/10 border-orange-800/50' 
      : 'bg-gray-800 border-gray-700 hover:border-gray-500';

  // Text color for availability
  const availabilityColor = freeGpus > 0 ? 'text-green-400' : 'text-gray-500';

  return (
    <div 
      className={`relative border rounded-xl p-5 transition-all duration-200 cursor-pointer group shadow-lg hover:shadow-xl ${statusColor}`}
      onClick={() => onClick(server)}
    >
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-lg ${isOnline ? 'bg-blue-500/10 text-blue-400' : 'bg-red-500/10 text-red-400'}`}>
            <Server size={24} />
          </div>
          <div className="overflow-hidden">
            <h3 className="font-bold text-lg text-gray-100 truncate pr-2">{server.name}</h3>
            <p className="text-xs text-gray-400 font-mono truncate">{server.ip}</p>
          </div>
        </div>
        <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${isOnline ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          {server.status}
        </div>
      </div>

      {isOnline ? (
        <div className="space-y-4">
          
          {/* Main Metric: Available GPUs */}
          <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/50 text-center">
            <div className="text-gray-400 text-[10px] uppercase font-bold tracking-widest mb-1">Available GPUs</div>
            <div className="flex items-baseline justify-center gap-1.5">
              <span className={`text-3xl font-black font-mono ${availabilityColor}`}>
                {freeGpus}
              </span>
              <span className="text-gray-500 text-sm font-medium">/ {totalGpus}</span>
            </div>
            {freeGpus === 0 && (
              <p className="text-[10px] text-red-400 mt-1 font-medium">Fully Occupied</p>
            )}
            {freeGpus > 0 && freeGpus === totalGpus && (
              <p className="text-[10px] text-green-500/70 mt-1 font-medium">All Free</p>
            )}
          </div>

          {/* Secondary Metrics Grid */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            {/* Memory Usage */}
            <div className="bg-gray-800/50 rounded p-2 flex flex-col justify-center items-center border border-gray-700/30">
               <span className="text-gray-500 flex items-center gap-1 mb-0.5"><Database size={12}/> Memory</span>
               <span className="font-mono font-bold text-gray-300">
                 {usedMemGB} <span className="text-[10px] text-gray-500 font-normal">/ {totalMemGB} GB</span>
               </span>
            </div>

            {/* Avg Load */}
            <div className="bg-gray-800/50 rounded p-2 flex flex-col justify-center items-center border border-gray-700/30">
               <span className="text-gray-500 flex items-center gap-1 mb-0.5"><Cpu size={12}/> Avg Load</span>
               <span className={`font-mono font-bold ${avgUtil > 80 ? 'text-orange-400' : 'text-gray-300'}`}>
                 {avgUtil}%
               </span>
            </div>

            {/* Peak Temp */}
            <div className="bg-gray-800/50 rounded p-2 flex flex-col justify-center items-center border border-gray-700/30">
               <span className="text-gray-500 flex items-center gap-1 mb-0.5"><Thermometer size={12}/> Peak Temp</span>
               <span className={`font-mono font-bold ${maxTemp > 80 ? 'text-red-400' : 'text-gray-300'}`}>
                 {maxTemp}°C
               </span>
            </div>
          </div>

        </div>
      ) : (
        <div className="h-28 flex flex-col items-center justify-center text-gray-500 text-sm italic bg-gray-900/20 rounded-lg border border-gray-800 border-dashed">
          <AlertTriangle size={20} className="mb-2 opacity-50"/>
          <span>Connection lost</span>
        </div>
      )}

      {/* Remove Button */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button 
          onClick={(e) => { e.stopPropagation(); onRemove(server.ip); }}
          className="p-1.5 hover:bg-red-500/20 rounded-md text-gray-600 hover:text-red-400 transition-colors"
          title="Remove Server"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </button>
      </div>
    </div>
  );
};

export default ServerCard;