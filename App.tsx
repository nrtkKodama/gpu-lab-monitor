import React, { useState, useEffect } from 'react';
import { ServerNode, ViewState } from './types';
import { fetchServerData, scanLocalNetwork } from './services/mockData';
import ServerCard from './components/ServerCard';
import ServerDetail from './components/ServerDetail';
import HelpGuide from './components/HelpGuide';
import { LayoutDashboard, Plus, Network, HelpCircle } from 'lucide-react';

const App: React.FC = () => {
  // Persistence: Load servers from localStorage on boot
  const [servers, setServers] = useState<ServerNode[]>([]);
  const [savedIPs, setSavedIPs] = useState<string[]>(() => {
    const saved = localStorage.getItem('gpu_lab_monitor_ips');
    return saved ? JSON.parse(saved) : ['192.168.1.100', '192.168.1.102']; // Defaults
  });

  const [viewState, setViewState] = useState<ViewState>(ViewState.DASHBOARD);
  const [selectedServer, setSelectedServer] = useState<ServerNode | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [newIp, setNewIp] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // Effect to sync savedIPs to localStorage
  useEffect(() => {
    localStorage.setItem('gpu_lab_monitor_ips', JSON.stringify(savedIPs));
    refreshAllData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedIPs]);

  // Periodic refresh
  useEffect(() => {
    const interval = setInterval(refreshAllData, 30000); // 30s auto refresh
    return () => clearInterval(interval);
  }, [savedIPs]);

  const refreshAllData = async () => {
    const promises = savedIPs.map((ip, idx) => fetchServerData(ip, `Lab-Node-${idx + 1}`));
    const results = await Promise.all(promises);
    setServers(results);
    
    // If viewing detail, update the selected server reference
    if (selectedServer) {
      const updated = results.find(s => s.id === selectedServer.id);
      if (updated) setSelectedServer(updated);
    }
  };

  const handleAddServer = () => {
    if (newIp && !savedIPs.includes(newIp)) {
      setSavedIPs([...savedIPs, newIp]);
      setNewIp('');
      setShowAddModal(false);
    }
  };

  const handleRemoveServer = (ip: string) => {
    if (confirm(`${ip} を監視リストから削除しますか？`)) {
      setSavedIPs(savedIPs.filter(s => s !== ip));
    }
  };

  const handleScanLan = async () => {
    setIsScanning(true);
    try {
      const foundIps = await scanLocalNetwork();
      const uniqueNew = foundIps.filter(ip => !savedIPs.includes(ip));
      if (uniqueNew.length > 0) {
        if (confirm(`${uniqueNew.length} 台の新しいデバイスが見つかりました。\n追加しますか？\n${uniqueNew.join(', ')}`)) {
          setSavedIPs([...savedIPs, ...uniqueNew]);
        }
      } else {
        alert("新しいデバイスは見つかりませんでした。");
      }
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans">
      {/* Navbar */}
      <nav className="border-b border-gray-800 bg-gray-900/95 sticky top-0 z-50 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => setViewState(ViewState.DASHBOARD)}>
              <div className="bg-blue-600 p-2 rounded-lg">
                <LayoutDashboard size={24} className="text-white" />
              </div>
              <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
                GPU Lab Monitor
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setViewState(ViewState.HELP)}
                className="text-gray-400 hover:text-white transition-colors flex items-center gap-1 text-sm"
              >
                <HelpCircle size={18}/> ガイド
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {viewState === ViewState.HELP && (
          <HelpGuide onClose={() => setViewState(ViewState.DASHBOARD)} />
        )}

        {viewState === ViewState.DETAIL && selectedServer && (
          <ServerDetail 
            server={selectedServer} 
            onBack={() => {
              setViewState(ViewState.DASHBOARD);
              setSelectedServer(null);
            }}
            onRefresh={refreshAllData}
          />
        )}

        {viewState === ViewState.DASHBOARD && (
          <div className="space-y-6 animate-fade-in">
            {/* Action Bar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-2xl font-bold text-white">Dashboard</h2>
                <p className="text-gray-400 text-sm">研究室GPUクラスタ稼働状況</p>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={handleScanLan}
                  disabled={isScanning}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-lg text-sm transition-all hover:border-gray-600"
                >
                  <Network size={16} className={isScanning ? "animate-pulse" : ""} />
                  {isScanning ? 'Scanning...' : 'Scan LAN'}
                </button>
                <button 
                  onClick={() => setShowAddModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium shadow-lg shadow-blue-900/20 transition-all"
                >
                  <Plus size={16} />
                  Add Server
                </button>
              </div>
            </div>

            {/* Server Grid */}
            {servers.length === 0 ? (
               <div className="text-center py-20 border-2 border-dashed border-gray-800 rounded-xl">
                 <p className="text-gray-500">監視対象のサーバーがありません。右上から追加してください。</p>
               </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {servers.map((server) => (
                  <ServerCard 
                    key={server.id} 
                    server={server} 
                    onClick={(s) => {
                      setSelectedServer(s);
                      setViewState(ViewState.DETAIL);
                    }}
                    onRemove={handleRemoveServer}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Add Server Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md border border-gray-700 shadow-2xl">
            <h3 className="text-xl font-bold mb-4">Add Monitoring Target</h3>
            <p className="text-gray-400 text-sm mb-4">
              エージェントが稼働しているサーバーのIPアドレスを入力してください。
            </p>
            <input 
              type="text" 
              placeholder="e.g., 192.168.1.50"
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-white mb-6 focus:ring-2 focus:ring-blue-500 outline-none"
              value={newIp}
              onChange={(e) => setNewIp(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddServer()}
            />
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleAddServer}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium"
              >
                Add Server
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global CSS Inject for Animations */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fadeIn 0.4s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

export default App;