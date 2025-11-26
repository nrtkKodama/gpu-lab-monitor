import React from 'react';
import { ServerNode } from '../types';
import { Server, AlertTriangle, Cpu, Thermometer, Database, Layers, Edit2, Trash2 } from 'lucide-react';

interface ServerCardProps {
  server: ServerNode;
  onClick: (server: ServerNode) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, newName: string) => void;
}

const ServerCard: React.FC<ServerCardProps> = ({ server, onClick, onRemove, onRename }) => {
  const isOnline = server.status === 'online';
  
  // Aggregate stats
  const totalGpus = server.gpus.length;
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
  const totalMemGB = totalMemMiB > 0 ? (totalMemMiB / 1024).toFixed(0) : '0';
  const usedMemGB = totalMemMiB > 0 ? (usedMemMiB / 1024).toFixed(1) : '0';
  const memPercent = totalMemMiB > 0 ? Math.round((usedMemMiB / totalMemMiB) * 100) : 0;
  
  const statusColor = !isOnline 
    ? 'bg-red-900/10 border-red-900/50' 
    : maxTemp > 80 
      ? 'bg-orange-900/10 border-orange-800/50' 
      : 'bg-gray-800 border-gray-700 hover:border-gray-500';

  const memBarColor = memPercent > 90 ? 'bg-red-500' : memPercent > 70 ? 'bg-yellow-500' : 'bg-blue-500';

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newName = window.prompt("新しいサーバー名を入力してください:", server.name);
    if (newName && newName.trim() !== "") {
      onRename(server.id, newName.trim());
    }
  };

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
          
          {/* Main Metric: Memory Usage Bar */}
          <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/50">
            <div className="flex justify-between items-end mb-1">
              <div className="text-gray-400 text-[10px] uppercase font-bold tracking-widest flex items-center gap-1">
                <Database size={10} /> Total Memory
              </div>
              <div className="text-xs font-mono text-gray-400">
                <span className="text-gray-200 font-bold">{usedMemGB}</span> / {totalMemGB} GB
              </div>
            </div>
            
            <div className="flex items-end gap-2 mb-2">
              <span className="text-3xl font-black font-mono text-gray-200">
                {memPercent}<span className="text-sm text-gray-500 ml-0.5">%</span>
              </span>
            </div>

            <div className="w-full bg-gray-700 h-2.5 rounded-full overflow-hidden">
              <div className={`h-full transition-all duration-500 ease-out ${memBarColor}`} style={{ width: `${memPercent}%` }}></div>
            </div>
          </div>

          {/* Secondary Metrics Grid */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-gray-800/50 rounded p-2 flex flex-col justify-center items-center border border-gray-700/30">
               <span className="text-gray-500 flex items-center gap-1 mb-0.5"><Layers size={12}/> Free GPUs</span>
               <span className={`font-mono font-bold ${freeGpus > 0 ? 'text-green-400' : 'text-gray-500'}`}>
                 {freeGpus} <span className="text-[10px] text-gray-500 font-normal">/ {totalGpus}</span>
               </span>
            </div>

            <div className="bg-gray-800/50 rounded p-2 flex flex-col justify-center items-center border border-gray-700/30">
               <span className="text-gray-500 flex items-center gap-1 mb-0.5"><Cpu size={12}/> Avg Load</span>
               <span className={`font-mono font-bold ${avgUtil > 80 ? 'text-orange-400' : 'text-gray-300'}`}>
                 {avgUtil}%
               </span>
            </div>

            <div className="bg-gray-800/50 rounded p-2 flex flex-col justify-center items-center border border-gray-700/30">
               <span className="text-gray-500 flex items-center gap-1 mb-0.5"><Thermometer size={12}/> Peak Temp</span>
               <span className={`font-mono font-bold ${maxTemp > 80 ? 'text-red-400' : 'text-gray-300'}`}>
                 {maxTemp}°C
               </span>
            </div>
          </div>

        </div>
      ) : (
        <div className="h-32 flex flex-col items-center justify-center text-gray-500 text-sm italic bg-gray-900/20 rounded-lg border border-gray-800 border-dashed">
          <AlertTriangle size={20} className="mb-2 opacity-50"/>
          <span>Connection lost</span>
        </div>
      )}

      {/* Action Buttons */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button 
          onClick={handleEdit}
          className="p-1.5 hover:bg-blue-500/20 rounded-md text-gray-600 hover:text-blue-400 transition-colors"
          title="Rename Server"
        >
          <Edit2 size={14} />
        </button>
        <button 
          onClick={(e) => { e.stopPropagation(); onRemove(server.id); }}
          className="p-1.5 hover:bg-red-500/20 rounded-md text-gray-600 hover:text-red-400 transition-colors"
          title="Remove Server"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
};

export default ServerCard;