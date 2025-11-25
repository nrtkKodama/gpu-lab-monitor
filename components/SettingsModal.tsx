import React, { useState } from 'react';
import { ServerConfig } from '../types';
import { Download, Upload, Copy, Check, Terminal, Save, X, XCircle } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  servers: ServerConfig[];
  onImport: (servers: ServerConfig[]) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, servers, onImport }) => {
  const [sshUser, setSshUser] = useState('user');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const generateSshConfig = () => {
    if (servers.length === 0) return "# サーバーが登録されていません";
    return servers.map(s => {
      // Host名にスペースが含まれる場合はハイフンに置換
      const hostAlias = s.name.replace(/\s+/g, '-');
      return `Host ${hostAlias}\n    HostName ${s.ip}\n    User ${sshUser}\n    # Port 22\n`;
    }).join('\n');
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generateSshConfig());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(servers, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `gpu-monitor-servers-${new Date().toISOString().slice(0, 10)}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    const files = event.target.files;
    setError(null);
    
    if (files && files.length > 0) {
      fileReader.readAsText(files[0], "UTF-8");
      fileReader.onload = (e) => {
        try {
          const result = e.target?.result;
          if (typeof result === 'string') {
            const parsed = JSON.parse(result);
            if (Array.isArray(parsed)) {
              // 簡易バリデーション
              const valid = parsed.every(item => item.name && item.ip);
              if (valid) {
                onImport(parsed);
                alert(`${parsed.length} 件のサーバー設定をインポートしました。`);
                onClose();
              } else {
                setError("JSON形式が不正です。各要素に 'name' と 'ip' が必要です。");
              }
            } else {
              setError("JSONは配列形式（[]）である必要があります。");
            }
          }
        } catch (err) {
            setError("JSONファイルの読み込みに失敗しました。ファイルが破損していないか確認してください。");
        }
      };
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-gray-800 rounded-xl w-full max-w-2xl border border-gray-700 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Save size={24} className="text-purple-400" />
            設定 & バックアップ
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-8 custom-scrollbar">
            
          {/* Backup / Restore Section */}
          <section>
            <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                <Download size={20} className="text-green-400"/>
                設定データの保存・復元
            </h3>
            <div className="bg-gray-700/30 rounded-lg p-4 border border-gray-600/50">
              <p className="text-sm text-gray-300 mb-4">
                  登録済みサーバーリストをJSONファイルとして保存、または読み込みます。<br/>
                  <span className="text-gray-400 text-xs">※通常、データはブラウザ(LocalStorage)に自動保存されますが、ブラウザ変更時やバックアップ用にご利用ください。</span>
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4">
                  <button 
                      onClick={handleExport}
                      className="flex-1 flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-white py-3 px-4 rounded-lg border border-gray-600 transition-colors font-medium"
                  >
                      <Download size={18} />
                      Export JSON
                  </button>
                  
                  <div className="flex-1 relative group">
                      <input 
                          type="file" 
                          accept=".json"
                          onChange={handleImport}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      />
                      <button className="w-full flex items-center justify-center gap-2 bg-blue-600 group-hover:bg-blue-500 text-white py-3 px-4 rounded-lg transition-colors font-medium shadow-lg shadow-blue-900/20">
                          <Upload size={18} />
                          Import JSON
                      </button>
                  </div>
              </div>
              {error && (
                <div className="mt-3 p-2 bg-red-900/30 text-red-300 text-sm rounded border border-red-800/50 flex items-center gap-2">
                  <XCircle size={14} /> {error}
                </div>
              )}
            </div>
          </section>

          <hr className="border-gray-700" />

          {/* SSH Config Section */}
          <section>
             <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                <Terminal size={20} className="text-orange-400"/>
                SSH Config 生成
            </h3>
            <div className="bg-gray-700/30 rounded-lg p-4 border border-gray-600/50">
              <p className="text-sm text-gray-300 mb-4">
                  登録サーバーの情報を <code>~/.ssh/config</code> 形式で生成します。
                  これを貼り付ければ、<code>ssh {`{ServerName}`}</code> で接続できるようになります。
              </p>

              <div className="mb-4 flex items-center gap-3">
                  <label className="text-sm text-gray-400 whitespace-nowrap">SSH Username:</label>
                  <input 
                      type="text" 
                      value={sshUser}
                      onChange={(e) => setSshUser(e.target.value)}
                      className="bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500 font-mono w-40"
                  />
              </div>

              <div className="relative group">
                  <pre className="bg-black/80 p-4 rounded-lg text-xs font-mono text-gray-300 h-48 overflow-y-auto border border-gray-700 whitespace-pre-wrap selection:bg-blue-500/50">
                      {generateSshConfig()}
                  </pre>
                  <button 
                      onClick={handleCopy}
                      className="absolute top-2 right-2 p-2 bg-gray-700/80 hover:bg-gray-600 rounded text-gray-300 hover:text-white transition-all backdrop-blur-sm opacity-0 group-hover:opacity-100"
                      title="クリップボードにコピー"
                  >
                      {copied ? <Check size={16} className="text-green-400"/> : <Copy size={16}/>}
                  </button>
              </div>
            </div>
          </section>
        </div>
      </div>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(31, 41, 55, 0.5); 
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(75, 85, 99, 0.8); 
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(107, 114, 128, 1); 
        }
      `}</style>
    </div>
  );
};

export default SettingsModal;