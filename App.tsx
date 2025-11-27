import React, { useState, useEffect } from 'react';
import { ServerNode, ViewState, ServerConfig } from './types';
import { fetchServerData, scanLocalNetwork, testServerConnection, fetchServerConfig, saveServerConfig } from './services/mockData';
import ServerCard from './components/ServerCard';
import ServerDetail from './components/ServerDetail';
import HelpGuide from './components/HelpGuide';
import SettingsModal from './components/SettingsModal';
import { LayoutDashboard, Plus, Network, HelpCircle, HardDrive, Search, Loader2, CheckCircle2, AlertTriangle, Settings, Cloud } from 'lucide-react';

const App: React.FC = () => {
  // Config Persistence: Now loaded from API, not localStorage directly
  const [savedServers, setSavedServers] = useState<ServerConfig[]>([]);
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);

  const [servers, setServers] = useState<ServerNode[]>([]);
  const [viewState, setViewState] = useState<ViewState>(ViewState.DASHBOARD);
  const [selectedServer, setSelectedServer] = useState<ServerNode | null>(null);
  
  // Scan State
  const [isScanning, setIsScanning] = useState(false);
  const [showScanModal, setShowScanModal] = useState(false);
  const [scanPrefix, setScanPrefix] = useState('192.168.1');
  
  // Add Server Form State
  const [newIp, setNewIp] = useState('');
  const [newName, setNewName] = useState('');
  const [newSshPort, setNewSshPort] = useState('22');
  const [showAddModal, setShowAddModal] = useState(false);
  
  // Settings State
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  
  // Connection Test State
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Initial Load & Sync Logic
  useEffect(() => {
    const initData = async () => {
      // 1. Fetch config from server
      const remoteConfig = await fetchServerConfig();
      
      // 2. Check for local data (migration path)
      const localString = localStorage.getItem('gpu_lab_monitor_ips');
      let localConfig: ServerConfig[] = [];
      try {
        if (localString) {
          const parsed = JSON.parse(localString);
           if (Array.isArray(parsed)) {
            localConfig = parsed.map((item: any, idx: number) => {
              if (typeof item === 'string') {
                return { id: `migrated-${Date.now()}-${idx}`, name: `Node-${idx + 1}`, ip: item, sshPort: 22 };
              }
              return { ...item, id: item.id || `migrated-${Date.now()}-${idx}`, sshPort: item.sshPort || 22 };
            });
           }
        }
      } catch (e) {
        console.error("Local storage migration error", e);
      }

      // 3. Sync Strategy
      if (remoteConfig.length === 0 && localConfig.length > 0) {
        // Migration: Upload local data to server
        console.log("Migrating local config to server...");
        await saveServerConfig(localConfig);
        setSavedServers(localConfig);
      } else {
        // Default: Use server data (it's the source of truth)
        setSavedServers(remoteConfig);
      }
      setIsConfigLoaded(true);
    };

    initData();
  }, []);

  // Update server data whenever savedServers changes
  useEffect(() => {
    if (isConfigLoaded) {
      refreshAllData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedServers, isConfigLoaded]);

  // Periodic refresh (also re-fetches config to sync with other users)
  useEffect(() => {
    if (!isConfigLoaded) return;

    const interval = setInterval(async () => {
       // Refresh config from backend to see if other users added servers
       const remoteConfig = await fetchServerConfig();
       // Only update state if JSON string representation differs to avoid unnecessary renders
       if (JSON.stringify(remoteConfig) !== JSON.stringify(savedServers)) {
           setSavedServers(remoteConfig);
       } else {
           // If config hasn't changed, just refresh the metrics
           refreshAllData();
       }
    }, 10000); // 10s auto refresh and sync

    return () => clearInterval(interval);
  }, [savedServers, isConfigLoaded]);

  const refreshAllData = async () => {
    const promises = savedServers.map((config) => fetchServerData(config));
    const results = await Promise.all(promises);
    setServers(results);
    
    // If viewing detail, update the selected server reference
    if (selectedServer) {
      const updated = results.find(s => s.id === selectedServer.id);
      if (updated) setSelectedServer(updated);
    }
  };

  // Helper to update state and persist to backend
  const updateServersList = async (newConfig: ServerConfig[]) => {
    setSavedServers(newConfig); // Optimistic update
    await saveServerConfig(newConfig); // Persist
  };

  const resetAddModal = () => {
    setNewIp('');
    setNewName('');
    setNewSshPort('22');
    setTestResult(null);
    setIsTesting(false);
    setShowAddModal(false);
  };

  const handleTestConnection = async () => {
    if (!newIp) return;
    setIsTesting(true);
    setTestResult(null);
    const result = await testServerConnection(newIp);
    setTestResult(result);
    setIsTesting(false);
  };

  const handleAddServer = async () => {
    if (newIp) {
      const port = parseInt(newSshPort) || 22;
      
      const isDuplicate = savedServers.some(s => s.ip === newIp && s.sshPort === port);
      if (isDuplicate) {
        alert("このサーバー（IPアドレスとポートの組み合わせ）は既に登録されています。");
        return;
      }
      
      const newId = crypto.randomUUID ? crypto.randomUUID() : `server-${Date.now()}`;
      const name = newName.trim() || `Server-${newIp.split('.').pop()}`;
      
      const newConfig = [...savedServers, { 
        id: newId,
        name, 
        ip: newIp,
        originalIp: newIp, 
        sshPort: port
      }];

      await updateServersList(newConfig);
      resetAddModal();
    }
  };

  const handleRemoveServer = async (id: string) => {
    const target = savedServers.find(s => s.id === id);
    if (target && confirm(`${target.name} (${target.ip}) を監視リストから削除しますか？\n(この操作は全ユーザーに反映されます)`)) {
      const newConfig = savedServers.filter(s => s.id !== id);
      await updateServersList(newConfig);
      setServers(servers.filter(s => s.id !== id)); // Clear from display immediately
    }
  };

  const handleRenameServer = async (id: string, newName: string) => {
    const newConfig = savedServers.map(s => 
      s.id === id ? { ...s, name: newName } : s
    );
    await updateServersList(newConfig);
    
    // Update selected server if it's the one being renamed
    if (selectedServer && selectedServer.id === id) {
        setSelectedServer(prev => prev ? { ...prev, name: newName } : null);
    }
  };

  const handleScanLan = async () => {
    setShowScanModal(false);
    setIsScanning(true);
    try {
      const prefix = scanPrefix.trim();
      if (!prefix.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
        alert("IPプレフィックスの形式が正しくありません。\n例: 192.168.1");
        setIsScanning(false);
        return;
      }

      const foundIps = await scanLocalNetwork(prefix);
      const existingIps = savedServers.map(s => s.ip);
      const uniqueNew = foundIps.filter(ip => !existingIps.includes(ip));
      
      if (uniqueNew.length > 0) {
        if (confirm(`${uniqueNew.length} 台の新しいデバイスが見つかりました。\n追加しますか？\n${uniqueNew.join(', ')}`)) {
          const newConfigs = uniqueNew.map((ip, idx) => ({ 
            id: `auto-${Date.now()}-${idx}`,
            name: `Auto-${ip.split('.').pop()}`, 
            ip,
            originalIp: ip,
            sshPort: 22
          }));
          await updateServersList([...savedServers, ...newConfigs]);
        }
      } else {
        alert(`スキャン完了: 範囲 ${prefix}.1 - 254\n新しいデバイスは見つかりませんでした。`);
      }
    } catch (e) {
      console.error(e);
      alert("スキャン中にエラーが発生しました。");
    } finally {
      setIsScanning(false);
    }
  };

  if (!isConfigLoaded) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-gray-400">
        <Loader2 size={48} className="animate-spin mb-4 text-blue-500" />
        <p>Loading configuration from server...</p>
      </div>
    );
  }

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
              <div className="hidden md:flex items-center gap-1 text-xs text-green-500 bg-green-900/20 px-2 py-1 rounded border border-green-800/50">
                  <Cloud size={12}/> Connected
              </div>
              <button 
                onClick={() => setShowSettingsModal(true)}
                className="text-gray-400 hover:text-white transition-colors flex items-center gap-1 text-sm"
              >
                <Settings size={18}/> 設定
              </button>
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
                  onClick={() => setShowScanModal(true)}
                  disabled={isScanning}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-lg text-sm transition-all hover:border-gray-600 disabled:opacity-50"
                >
                  {isScanning ? <Loader2 size={16} className="animate-spin"/> : <Network size={16} />}
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
                 <HardDrive size={48} className="mx-auto text-gray-600 mb-4" />
                 <h3 className="text-xl font-medium text-gray-300">監視サーバーが登録されていません</h3>
                 <p className="text-gray-500 mb-6">右上の "Add Server" ボタンから登録を開始してください。</p>
                 <button 
                  onClick={() => setShowAddModal(true)}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg"
                 >
                   最初のサーバーを追加
                 </button>
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
                    onRename={handleRenameServer}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Settings Modal */}
      <SettingsModal 
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        servers={savedServers}
        onImport={(imported) => {
             // Ensure IDs exist on imported data
             const sanitized = imported.map((s, i) => ({
                 ...s,
                 id: s.id || `import-${Date.now()}-${i}`,
                 sshPort: s.sshPort || 22
             }));
             updateServersList(sanitized); // Save to server immediately
        }}
      />

      {/* Scan Config Modal */}
      {showScanModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md border border-gray-700 shadow-2xl">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Search size={24} className="text-blue-400" />
              LANスキャン設定
            </h3>
            
            <div className="space-y-4">
              <p className="text-sm text-gray-400">
                指定されたサブネットの <code>.1</code> ～ <code>.254</code> に対して、GPU監視エージェント(Port 8000)の応答を確認します。
              </p>
              <div>
                <label className="block text-sm text-gray-300 mb-1">IP Prefix (第3オクテットまで)</label>
                <div className="flex items-center">
                  <input 
                    type="text" 
                    placeholder="例: 192.168.1"
                    className="flex-1 bg-gray-900 border border-gray-600 rounded-l-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono tracking-wide"
                    value={scanPrefix}
                    onChange={(e) => setScanPrefix(e.target.value)}
                  />
                  <span className="bg-gray-700 border border-l-0 border-gray-600 rounded-r-lg px-3 py-2 text-gray-400 font-mono">
                    .x
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-8">
              <button 
                onClick={() => setShowScanModal(false)}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleScanLan}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium"
              >
                Start Scan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Server Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md border border-gray-700 shadow-2xl">
            <h3 className="text-xl font-bold mb-4">サーバー追加</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Server Name (任意)</label>
                <input 
                  type="text" 
                  placeholder="例: A100-Node-01"
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">IP Address & SSH Port</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder="192.168.1.50"
                    className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                    value={newIp}
                    onChange={(e) => setNewIp(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddServer()}
                  />
                  <div className="w-24 relative">
                    <span className="absolute left-2 top-2 text-gray-500 text-xs font-mono">Port</span>
                    <input 
                      type="number" 
                      placeholder="22"
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg pl-10 pr-2 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono text-center"
                      value={newSshPort}
                      onChange={(e) => setNewSshPort(e.target.value)}
                    />
                  </div>
                </div>
                <div className="mt-2 text-right">
                  <button 
                    onClick={handleTestConnection}
                    disabled={!newIp || isTesting}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-gray-200 border border-gray-600 disabled:opacity-50 whitespace-nowrap"
                  >
                    {isTesting ? <Loader2 size={14} className="animate-spin inline mr-1"/> : null} 接続テスト (Agent)
                  </button>
                </div>
              </div>
              
              {/* Test Results */}
              {testResult && (
                <div className={`p-3 rounded-lg text-sm flex items-start gap-2 border ${testResult.success ? 'bg-green-900/20 border-green-800 text-green-200' : 'bg-red-900/20 border-red-800 text-red-200'}`}>
                  {testResult.success ? <CheckCircle2 size={18} className="mt-0.5 shrink-0"/> : <AlertTriangle size={18} className="mt-0.5 shrink-0"/>}
                  <span>{testResult.message}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-8">
              <button 
                onClick={resetAddModal}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleAddServer}
                disabled={!newIp}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white rounded-lg font-medium"
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