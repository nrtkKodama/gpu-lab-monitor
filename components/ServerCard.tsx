import React from 'react';
import { ServerNode } from '../types';
import { Server, Activity, AlertTriangle, Cpu } from 'lucide-react';

interface ServerCardProps {
  server: ServerNode;
  onClick: (server: ServerNode) => void;
  onRemove: (ip: string) => void;
}

const ServerCard: React.FC<ServerCardProps> = ({ server, onClick, onRemove }) => {
  const isOnline = server.status === 'online';
  
  // Aggregate stats
  const totalGpus = server.gpus.length;
  const avgUtil = totalGpus > 0 
    ? Math.round(server.gpus.reduce((acc, gpu) => acc + gpu.utilization.gpu, 0) / totalGpus)
    : 0;
  const maxTemp = totalGpus > 0
    ? Math.max(...server.gpus.map(g => g.temperature))
    : 0;
  
  const statusColor = !isOnline 
    ? 'bg-red-900/20 border-red-800' 
    : maxTemp > 80 
      ? 'bg-orange-900/20 border-orange-800' 
      : 'bg-gray-800 border-gray-700 hover:bg-gray-750';

  return (
    <div 
      className={`relative border rounded-xl p-5 transition-all duration-200 cursor-pointer group ${statusColor}`}
      onClick={() => onClick(server)}
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-lg ${isOnline ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}>
            <Server size={24} />
          </div>
          <div>
            <h3 className="font-bold text-lg text-gray-100">{server.name}</h3>
            <p className="text-xs text-gray-400 font-mono">{server.ip}</p>
          </div>
        </div>
        <div className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${isOnline ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
          {server.status}
        </div>
      </div>

      {isOnline ? (
        <div className="space-y-3">
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-400 flex items-center gap-1"><Cpu size={14}/> GPUs</span>
            <span className="font-mono text-gray-200">{totalGpus} Units</span>
          </div>
          
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-400">
              <span>Avg Load</span>
              <span>{avgUtil}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div 
                className={`h-2 rounded-full ${avgUtil > 80 ? 'bg-red-500' : avgUtil > 50 ? 'bg-yellow-500' : 'bg-green-500'}`} 
                style={{ width: `${avgUtil}%` }}
              ></div>
            </div>
          </div>

          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-400 flex items-center gap-1"><AlertTriangle size={14}/> Peak Temp</span>
            <span className={`font-mono ${maxTemp > 80 ? 'text-red-400 font-bold' : 'text-gray-200'}`}>{maxTemp}°C</span>
          </div>
        </div>
      ) : (
        <div className="h-24 flex items-center justify-center text-gray-500 text-sm italic">
          Connection lost or agent offline
        </div>
      )}

      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button 
          onClick={(e) => { e.stopPropagation(); onRemove(server.ip); }}
          className="p-1 hover:bg-red-500/20 rounded text-gray-500 hover:text-red-400"
          title="Remove Server"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </button>
      </div>
    </div>
  );
};

export default ServerCard;